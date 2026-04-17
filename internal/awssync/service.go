package awssync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/credentials/stscreds"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/ec2"
	"github.com/aws/aws-sdk-go/service/rds"
	"github.com/google/uuid"

	awsrepo "ops-platform/internal/aws"
	"ops-platform/internal/config"
)

const (
	resourceEC2 = "ec2_instance"
	resourceVPC = "vpc"
	resourceSG  = "security_group"
	resourceRDS = "rds_instance"
)

type Service struct {
	cfg      config.Config
	db       *sql.DB
	accounts *awsrepo.Repository
	logger   *log.Logger
}

func NewService(cfg config.Config, db *sql.DB, accounts *awsrepo.Repository) *Service {
	return &Service{
		cfg:      cfg,
		db:       db,
		accounts: accounts,
		logger:   log.New(log.Writer(), "aws-sync ", log.LstdFlags),
	}
}

func (s *Service) RunLoop(ctx context.Context) {
	if s.cfg.SyncRunOnStart {
		if err := s.RunOnce(ctx); err != nil {
			s.logger.Printf("initial sync failed: %v", err)
		}
	}

	ticker := time.NewTicker(s.cfg.SyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.logger.Printf("sync loop stopped")
			return
		case <-ticker.C:
			if err := s.RunOnce(ctx); err != nil {
				s.logger.Printf("scheduled sync failed: %v", err)
			}
		}
	}
}

func (s *Service) RunOnce(ctx context.Context) error {
	accounts, err := s.accounts.ListSyncAccounts(ctx)
	if err != nil {
		return err
	}
	if len(accounts) == 0 {
		s.logger.Printf("no enabled aws account for sync")
		return nil
	}

	var syncErr error
	for _, account := range accounts {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if len(account.RegionAllowlist) == 0 {
			s.logger.Printf("skip account %s: no regions configured", account.AccountID)
			continue
		}

		for _, region := range account.RegionAllowlist {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			region = strings.TrimSpace(region)
			if region == "" {
				continue
			}

			if err := s.syncAccountRegion(ctx, account, region); err != nil {
				syncErr = errors.Join(syncErr, err)
			}
		}
	}

	if err := s.syncRelations(ctx); err != nil {
		syncErr = errors.Join(syncErr, fmt.Errorf("sync relations: %w", err))
	}

	return syncErr
}

func (s *Service) syncAccountRegion(ctx context.Context, account awsrepo.SyncAccount, region string) error {
	sess, err := s.buildSession(account, region)
	if err != nil {
		return fmt.Errorf("account %s region %s session: %w", account.AccountID, region, err)
	}

	resourceSyncs := []struct {
		name string
		run  func(context.Context, *session.Session, awsrepo.SyncAccount, string) (int, error)
	}{
		{name: resourceEC2, run: s.syncEC2Instances},
		{name: resourceVPC, run: s.syncVPCs},
		{name: resourceSG, run: s.syncSecurityGroups},
		{name: resourceRDS, run: s.syncRDSInstances},
	}

	var runErr error
	for _, resource := range resourceSyncs {
		runID, err := s.accounts.StartSyncRun(ctx, account.ID, region, resource.name)
		if err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("start run %s for %s/%s: %w", resource.name, account.AccountID, region, err))
			continue
		}

		start := time.Now()
		count, resourceErr := resource.run(ctx, sess, account, region)
		status := "success"
		message := ""
		if resourceErr != nil {
			status = "failed"
			message = resourceErr.Error()
			runErr = errors.Join(runErr, fmt.Errorf("sync %s for %s/%s: %w", resource.name, account.AccountID, region, resourceErr))
		}
		if err := s.accounts.FinishSyncRun(ctx, runID, status, count, message); err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("finish run %s for %s/%s: %w", resource.name, account.AccountID, region, err))
		}

		s.logger.Printf(
			"account=%s region=%s resource=%s processed=%d status=%s duration=%s",
			account.AccountID,
			region,
			resource.name,
			count,
			status,
			time.Since(start).Round(time.Millisecond),
		)
	}

	return runErr
}

func (s *Service) syncRelations(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `
SELECT id::text, vpc_id, subnet_id
FROM cmdb_asset
WHERE source = 'aws' AND deleted_at IS NULL
  AND (vpc_id != '' OR subnet_id != '')
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type pending struct {
		assetID  string
		vpcID    string
		subnetID string
	}
	var items []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.assetID, &p.vpcID, &p.subnetID); err != nil {
			return err
		}
		items = append(items, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	lookup := make(map[string]string)
	resolveID := func(externalID string) string {
		if externalID == "" {
			return ""
		}
		if cached, ok := lookup[externalID]; ok {
			return cached
		}
		var id string
		err := s.db.QueryRowContext(ctx, `
SELECT id::text FROM cmdb_asset WHERE source = 'aws' AND external_id = $1 AND deleted_at IS NULL LIMIT 1
`, externalID).Scan(&id)
		if err != nil {
			lookup[externalID] = ""
			return ""
		}
		lookup[externalID] = id
		return id
	}

	var relErr error
	for _, item := range items {
		if item.vpcID != "" {
			if targetID := resolveID(item.vpcID); targetID != "" && targetID != item.assetID {
				_, err := s.db.ExecContext(ctx, `
INSERT INTO cmdb_asset_relation (from_asset_id, to_asset_id, relation_type, source)
VALUES ($1::uuid, $2::uuid, 'in_vpc', 'aws')
ON CONFLICT (from_asset_id, to_asset_id, relation_type) DO UPDATE SET updated_at = now()
`, item.assetID, targetID)
				if err != nil {
					relErr = errors.Join(relErr, err)
				}
			}
		}
		if item.subnetID != "" {
			if targetID := resolveID(item.subnetID); targetID != "" && targetID != item.assetID {
				_, err := s.db.ExecContext(ctx, `
INSERT INTO cmdb_asset_relation (from_asset_id, to_asset_id, relation_type, source)
VALUES ($1::uuid, $2::uuid, 'in_subnet', 'aws')
ON CONFLICT (from_asset_id, to_asset_id, relation_type) DO UPDATE SET updated_at = now()
`, item.assetID, targetID)
				if err != nil {
					relErr = errors.Join(relErr, err)
				}
			}
		}
	}
	return relErr
}

func (s *Service) buildSession(account awsrepo.SyncAccount, region string) (*session.Session, error) {
	baseConfig := awssdk.NewConfig().WithRegion(region)
	if account.AccessKeyID != "" && account.SecretAccessKey != "" {
		baseConfig = baseConfig.WithCredentials(credentials.NewStaticCredentials(account.AccessKeyID, account.SecretAccessKey, ""))
	}
	baseSession, err := session.NewSession(baseConfig)
	if err != nil {
		return nil, err
	}

	switch account.AuthMode {
	case "static":
		if account.AccessKeyID == "" || account.SecretAccessKey == "" {
			return nil, errors.New("static mode requires access_key_id and secret_access_key")
		}
		return baseSession, nil
	case "", "assume_role":
		if strings.TrimSpace(account.RoleARN) == "" {
			if account.AccessKeyID != "" && account.SecretAccessKey != "" {
				return baseSession, nil
			}
			return nil, errors.New("assume_role mode requires role_arn")
		}
		assumeCreds := stscreds.NewCredentials(baseSession, account.RoleARN, func(options *stscreds.AssumeRoleProvider) {
			if account.ExternalID != "" {
				options.ExternalID = awssdk.String(account.ExternalID)
			}
		})
		return session.NewSession(
			awssdk.NewConfig().
				WithRegion(region).
				WithCredentials(assumeCreds),
		)
	default:
		return nil, fmt.Errorf("unsupported auth_mode: %s", account.AuthMode)
	}
}

func (s *Service) syncEC2Instances(ctx context.Context, sess *session.Session, account awsrepo.SyncAccount, region string) (int, error) {
	client := ec2.New(sess, awssdk.NewConfig().WithRegion(region))
	count := 0
	var syncErr error

	input := &ec2.DescribeInstancesInput{}
	err := client.DescribeInstancesPagesWithContext(ctx, input, func(output *ec2.DescribeInstancesOutput, _ bool) bool {
		for _, reservation := range output.Reservations {
			for _, instance := range reservation.Instances {
				externalID := awssdk.StringValue(instance.InstanceId)
				if externalID == "" {
					continue
				}
				userTags := ec2TagsToMap(instance.Tags)
				zone := ""
				if instance.Placement != nil {
					zone = awssdk.StringValue(instance.Placement.AvailabilityZone)
				}
				subnetID := awssdk.StringValue(instance.SubnetId)
				vpcID := awssdk.StringValue(instance.VpcId)
				imageID := awssdk.StringValue(instance.ImageId)
				sysTags := map[string]any{
					"aws_account_id":    account.AccountID,
					"aws_region":        region,
					"aws_resource_type": resourceEC2,
					"instance_type":     awssdk.StringValue(instance.InstanceType),
					"availability_zone": zone,
					"vpc_id":            vpcID,
					"subnet_id":         subnetID,
					"image_id":          imageID,
				}
				asset := awsAsset{
					AssetType:    "aws_ec2_instance",
					Name:         coalesce(tagValue(userTags, "Name"), externalID),
					Status:       strings.ToLower(awssdk.StringValue(instance.State.Name)),
					Env:          inferEnv(userTags),
					ExternalID:   externalID,
					ExternalARN:  fmt.Sprintf("arn:aws:ec2:%s:%s:instance/%s", region, account.AccountID, externalID),
					PublicIP:     awssdk.StringValue(instance.PublicIpAddress),
					PrivateIP:    awssdk.StringValue(instance.PrivateIpAddress),
					PrivateDNS:   awssdk.StringValue(instance.PrivateDnsName),
					Region:       region,
					Zone:         zone,
					AccountID:    account.AccountID,
					InstanceType: awssdk.StringValue(instance.InstanceType),
					OSImage:      imageID,
					VPCID:        vpcID,
					SubnetID:     subnetID,
					KeyName:      awssdk.StringValue(instance.KeyName),
					Owner:        tagValue(userTags, "Owner"),
					BusinessUnit: tagValue(userTags, "BusinessUnit"),
					SystemTags:   sysTags,
					Labels:       userTags,
				}
				if err := s.upsertAWSAsset(ctx, asset); err != nil {
					syncErr = errors.Join(syncErr, err)
					continue
				}
				count++
			}
		}
		return true
	})
	if err != nil {
		syncErr = errors.Join(syncErr, err)
	}
	return count, syncErr
}

func (s *Service) syncVPCs(ctx context.Context, sess *session.Session, account awsrepo.SyncAccount, region string) (int, error) {
	client := ec2.New(sess, awssdk.NewConfig().WithRegion(region))
	count := 0
	var syncErr error

	err := client.DescribeVpcsPagesWithContext(ctx, &ec2.DescribeVpcsInput{}, func(output *ec2.DescribeVpcsOutput, _ bool) bool {
		for _, vpc := range output.Vpcs {
			externalID := awssdk.StringValue(vpc.VpcId)
			if externalID == "" {
				continue
			}
			userTags := ec2TagsToMap(vpc.Tags)
			sysTags := map[string]any{
				"aws_account_id":    account.AccountID,
				"aws_region":        region,
				"aws_resource_type": resourceVPC,
				"cidr":              awssdk.StringValue(vpc.CidrBlock),
				"is_default":        awssdk.BoolValue(vpc.IsDefault),
			}
			asset := awsAsset{
				AssetType:   "aws_vpc",
				Name:        coalesce(tagValue(userTags, "Name"), externalID),
				Status:      strings.ToLower(awssdk.StringValue(vpc.State)),
				Env:         inferEnv(userTags),
				ExternalID:  externalID,
				ExternalARN: fmt.Sprintf("arn:aws:ec2:%s:%s:vpc/%s", region, account.AccountID, externalID),
				Region:      region,
				AccountID:   account.AccountID,
				VPCID:       externalID,
				SystemTags:  sysTags,
				Labels:      userTags,
			}
			if err := s.upsertAWSAsset(ctx, asset); err != nil {
				syncErr = errors.Join(syncErr, err)
				continue
			}
			count++
		}
		return true
	})
	if err != nil {
		syncErr = errors.Join(syncErr, err)
	}
	return count, syncErr
}

func (s *Service) syncSecurityGroups(ctx context.Context, sess *session.Session, account awsrepo.SyncAccount, region string) (int, error) {
	client := ec2.New(sess, awssdk.NewConfig().WithRegion(region))
	count := 0
	var syncErr error

	err := client.DescribeSecurityGroupsPagesWithContext(ctx, &ec2.DescribeSecurityGroupsInput{}, func(output *ec2.DescribeSecurityGroupsOutput, _ bool) bool {
		for _, group := range output.SecurityGroups {
			externalID := awssdk.StringValue(group.GroupId)
			if externalID == "" {
				continue
			}
			userTags := ec2TagsToMap(group.Tags)
			vpcID := awssdk.StringValue(group.VpcId)
			sysTags := map[string]any{
				"aws_account_id":    account.AccountID,
				"aws_region":        region,
				"aws_resource_type": resourceSG,
				"vpc_id":            vpcID,
				"group_name":        awssdk.StringValue(group.GroupName),
				"description":       awssdk.StringValue(group.Description),
			}
			asset := awsAsset{
				AssetType:   "aws_security_group",
				Name:        coalesce(awssdk.StringValue(group.GroupName), externalID),
				Status:      "active",
				Env:         inferEnv(userTags),
				ExternalID:  externalID,
				ExternalARN: fmt.Sprintf("arn:aws:ec2:%s:%s:security-group/%s", region, account.AccountID, externalID),
				Region:      region,
				AccountID:   account.AccountID,
				VPCID:       vpcID,
				SystemTags:  sysTags,
				Labels:      userTags,
			}
			if err := s.upsertAWSAsset(ctx, asset); err != nil {
				syncErr = errors.Join(syncErr, err)
				continue
			}
			count++
		}
		return true
	})
	if err != nil {
		syncErr = errors.Join(syncErr, err)
	}
	return count, syncErr
}

func (s *Service) syncRDSInstances(ctx context.Context, sess *session.Session, account awsrepo.SyncAccount, region string) (int, error) {
	client := rds.New(sess, awssdk.NewConfig().WithRegion(region))
	count := 0
	var syncErr error

	err := client.DescribeDBInstancesPagesWithContext(ctx, &rds.DescribeDBInstancesInput{}, func(output *rds.DescribeDBInstancesOutput, _ bool) bool {
		for _, instance := range output.DBInstances {
			externalID := awssdk.StringValue(instance.DBInstanceIdentifier)
			if externalID == "" {
				continue
			}

			endpoint := ""
			if instance.Endpoint != nil {
				endpoint = awssdk.StringValue(instance.Endpoint.Address)
			}
			sysTags := map[string]any{
				"aws_account_id":    account.AccountID,
				"aws_region":        region,
				"aws_resource_type": resourceRDS,
				"engine":            awssdk.StringValue(instance.Engine),
				"engine_version":    awssdk.StringValue(instance.EngineVersion),
				"instance_class":    awssdk.StringValue(instance.DBInstanceClass),
				"multi_az":          awssdk.BoolValue(instance.MultiAZ),
				"endpoint":          endpoint,
			}
			userTags := map[string]any{}
			if instance.DBInstanceArn != nil {
				tagOutput, err := client.ListTagsForResourceWithContext(ctx, &rds.ListTagsForResourceInput{
					ResourceName: instance.DBInstanceArn,
				})
				if err == nil {
					for _, tag := range tagOutput.TagList {
						if tag.Key == nil || tag.Value == nil {
							continue
						}
						userTags[*tag.Key] = *tag.Value
					}
				}
			}

			asset := awsAsset{
				AssetType:    "aws_rds_instance",
				Name:         coalesce(tagValue(userTags, "Name"), externalID),
				Status:       strings.ToLower(awssdk.StringValue(instance.DBInstanceStatus)),
				Env:          inferEnv(userTags),
				ExternalID:   externalID,
				ExternalARN:  awssdk.StringValue(instance.DBInstanceArn),
				PrivateDNS:   endpoint,
				Region:       region,
				AccountID:    account.AccountID,
				InstanceType: awssdk.StringValue(instance.DBInstanceClass),
				Owner:        tagValue(userTags, "Owner"),
				BusinessUnit: tagValue(userTags, "BusinessUnit"),
				SystemTags:   sysTags,
				Labels:       userTags,
			}
			if err := s.upsertAWSAsset(ctx, asset); err != nil {
				syncErr = errors.Join(syncErr, err)
				continue
			}
			count++
		}
		return true
	})
	if err != nil {
		syncErr = errors.Join(syncErr, err)
	}
	return count, syncErr
}

type awsAsset struct {
	AssetType    string
	Name         string
	Status       string
	Env          string
	ExternalID   string
	ExternalARN  string
	PublicIP     string
	PrivateIP    string
	PrivateDNS   string
	Region       string
	Zone         string
	AccountID    string
	InstanceType string
	OSImage      string
	VPCID        string
	SubnetID     string
	KeyName      string
	Owner        string
	BusinessUnit string
	SystemTags   map[string]any
	Labels       map[string]any
}

func (s *Service) upsertAWSAsset(ctx context.Context, item awsAsset) error {
	if strings.TrimSpace(item.ExternalID) == "" {
		return errors.New("external id is required")
	}
	if strings.TrimSpace(item.AssetType) == "" {
		return errors.New("asset type is required")
	}

	if strings.TrimSpace(item.Name) == "" {
		item.Name = item.ExternalID
	}
	if strings.TrimSpace(item.Status) == "" {
		item.Status = "active"
	}
	item.Status = strings.ToLower(strings.TrimSpace(item.Status))

	if item.Env == "" {
		item.Env = inferEnv(item.Labels)
	}
	if item.Env == "" {
		item.Env = "default"
	}

	if item.SystemTags == nil {
		item.SystemTags = map[string]any{}
	}
	if item.Labels == nil {
		item.Labels = map[string]any{}
	}

	rawSystem, err := json.Marshal(item.SystemTags)
	if err != nil {
		return err
	}
	rawLabels, err := json.Marshal(item.Labels)
	if err != nil {
		return err
	}

	var existingID string
	err = s.db.QueryRowContext(ctx, `
SELECT id::text
FROM cmdb_asset
WHERE source = 'aws' AND external_id = $1
ORDER BY updated_at DESC
LIMIT 1
`, item.ExternalID).Scan(&existingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	if errors.Is(err, sql.ErrNoRows) {
		// First observation: system_tags fully authoritative, labels seeded with
		// AWS-origin user tags. After this, we only overwrite system_tags on sync
		// so user edits to labels are preserved.
		_, err = s.db.ExecContext(ctx, `
INSERT INTO cmdb_asset (
    id, type, name, status, env, source,
    external_id, external_arn,
    public_ip, private_ip, private_dns,
    region, zone, account_id, instance_type, os_image, vpc_id, subnet_id, key_name,
    owner, business_unit,
    system_tags, labels
) VALUES (
    $1, $2, $3, $4, $5, 'aws',
    $6, NULLIF($7, ''),
    $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18,
    $19, $20,
    $21, $22
)
`,
			uuid.NewString(),
			item.AssetType,
			item.Name,
			item.Status,
			item.Env,
			item.ExternalID,
			item.ExternalARN,
			strings.TrimSpace(item.PublicIP),
			strings.TrimSpace(item.PrivateIP),
			strings.TrimSpace(item.PrivateDNS),
			strings.TrimSpace(item.Region),
			strings.TrimSpace(item.Zone),
			strings.TrimSpace(item.AccountID),
			strings.TrimSpace(item.InstanceType),
			strings.TrimSpace(item.OSImage),
			strings.TrimSpace(item.VPCID),
			strings.TrimSpace(item.SubnetID),
			strings.TrimSpace(item.KeyName),
			strings.TrimSpace(item.Owner),
			strings.TrimSpace(item.BusinessUnit),
			rawSystem,
			rawLabels,
		)
		return err
	}

	// Subsequent syncs: update observed infra attributes and system_tags, but
	// leave user labels, owner, business_unit, criticality, expires_at alone so
	// human curation isn't clobbered.
	_, err = s.db.ExecContext(ctx, `
UPDATE cmdb_asset
SET type = $2,
    name = $3,
    status = $4,
    env = $5,
    source = 'aws',
    external_arn = NULLIF($6, ''),
    public_ip = $7,
    private_ip = $8,
    private_dns = $9,
    region = $10,
    zone = $11,
    account_id = $12,
    instance_type = $13,
    os_image = $14,
    vpc_id = $15,
    subnet_id = $16,
    key_name = $17,
    system_tags = $18,
    deleted_at = NULL,
    updated_at = now()
WHERE id::text = $1
`,
		existingID,
		item.AssetType,
		item.Name,
		item.Status,
		item.Env,
		item.ExternalARN,
		strings.TrimSpace(item.PublicIP),
		strings.TrimSpace(item.PrivateIP),
		strings.TrimSpace(item.PrivateDNS),
		strings.TrimSpace(item.Region),
		strings.TrimSpace(item.Zone),
		strings.TrimSpace(item.AccountID),
		strings.TrimSpace(item.InstanceType),
		strings.TrimSpace(item.OSImage),
		strings.TrimSpace(item.VPCID),
		strings.TrimSpace(item.SubnetID),
		strings.TrimSpace(item.KeyName),
		rawSystem,
	)
	return err
}

func ec2TagsToMap(tags []*ec2.Tag) map[string]any {
	result := make(map[string]any, len(tags))
	for _, tag := range tags {
		if tag == nil || tag.Key == nil || tag.Value == nil {
			continue
		}
		result[*tag.Key] = *tag.Value
	}
	return result
}

func inferEnv(tags map[string]any) string {
	keys := []string{"env", "environment", "stage", "Env", "Environment", "Stage"}
	for _, key := range keys {
		if value := strings.TrimSpace(tagValue(tags, key)); value != "" {
			return strings.ToLower(value)
		}
	}
	return "default"
}

func tagValue(tags map[string]any, key string) string {
	if tags == nil {
		return ""
	}
	value, ok := tags[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func coalesce(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
