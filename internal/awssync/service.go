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
				tags := ec2TagsToMap(instance.Tags)
				tags["aws_account_id"] = account.AccountID
				tags["aws_region"] = region
				tags["aws_resource_type"] = resourceEC2
				tags["instance_type"] = awssdk.StringValue(instance.InstanceType)
				tags["private_ip"] = awssdk.StringValue(instance.PrivateIpAddress)
				tags["public_ip"] = awssdk.StringValue(instance.PublicIpAddress)

				asset := awsAsset{
					AssetType:   "aws_ec2_instance",
					Name:        coalesce(tagValue(tags, "Name"), externalID),
					Status:      strings.ToLower(awssdk.StringValue(instance.State.Name)),
					Env:         inferEnv(tags),
					ExternalID:  externalID,
					ExternalARN: fmt.Sprintf("arn:aws:ec2:%s:%s:instance/%s", region, account.AccountID, externalID),
					Tags:        tags,
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
			tags := ec2TagsToMap(vpc.Tags)
			tags["aws_account_id"] = account.AccountID
			tags["aws_region"] = region
			tags["aws_resource_type"] = resourceVPC
			tags["cidr"] = awssdk.StringValue(vpc.CidrBlock)
			tags["is_default"] = awssdk.BoolValue(vpc.IsDefault)

			asset := awsAsset{
				AssetType:   "aws_vpc",
				Name:        coalesce(tagValue(tags, "Name"), externalID),
				Status:      strings.ToLower(awssdk.StringValue(vpc.State)),
				Env:         inferEnv(tags),
				ExternalID:  externalID,
				ExternalARN: fmt.Sprintf("arn:aws:ec2:%s:%s:vpc/%s", region, account.AccountID, externalID),
				Tags:        tags,
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
			tags := ec2TagsToMap(group.Tags)
			tags["aws_account_id"] = account.AccountID
			tags["aws_region"] = region
			tags["aws_resource_type"] = resourceSG
			tags["vpc_id"] = awssdk.StringValue(group.VpcId)
			tags["group_name"] = awssdk.StringValue(group.GroupName)
			tags["description"] = awssdk.StringValue(group.Description)

			asset := awsAsset{
				AssetType:   "aws_security_group",
				Name:        coalesce(awssdk.StringValue(group.GroupName), externalID),
				Status:      "active",
				Env:         inferEnv(tags),
				ExternalID:  externalID,
				ExternalARN: fmt.Sprintf("arn:aws:ec2:%s:%s:security-group/%s", region, account.AccountID, externalID),
				Tags:        tags,
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

			tags := map[string]any{
				"aws_account_id":    account.AccountID,
				"aws_region":        region,
				"aws_resource_type": resourceRDS,
				"engine":            awssdk.StringValue(instance.Engine),
				"engine_version":    awssdk.StringValue(instance.EngineVersion),
				"instance_class":    awssdk.StringValue(instance.DBInstanceClass),
				"multi_az":          awssdk.BoolValue(instance.MultiAZ),
				"endpoint":          "",
			}
			if instance.Endpoint != nil {
				tags["endpoint"] = awssdk.StringValue(instance.Endpoint.Address)
			}
			if instance.DBInstanceArn != nil {
				tagOutput, err := client.ListTagsForResourceWithContext(ctx, &rds.ListTagsForResourceInput{
					ResourceName: instance.DBInstanceArn,
				})
				if err == nil {
					for _, tag := range tagOutput.TagList {
						if tag.Key == nil || tag.Value == nil {
							continue
						}
						tags[*tag.Key] = *tag.Value
					}
				}
			}

			asset := awsAsset{
				AssetType:   "aws_rds_instance",
				Name:        coalesce(tagValue(tags, "Name"), externalID),
				Status:      strings.ToLower(awssdk.StringValue(instance.DBInstanceStatus)),
				Env:         inferEnv(tags),
				ExternalID:  externalID,
				ExternalARN: awssdk.StringValue(instance.DBInstanceArn),
				Tags:        tags,
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
	AssetType   string
	Name        string
	Status      string
	Env         string
	ExternalID  string
	ExternalARN string
	Tags        map[string]any
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
		item.Env = inferEnv(item.Tags)
	}
	if item.Env == "" {
		item.Env = "default"
	}

	rawTags, err := json.Marshal(item.Tags)
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
		_, err = s.db.ExecContext(ctx, `
INSERT INTO cmdb_asset (id, type, name, status, env, source, external_id, external_arn, tags)
VALUES ($1, $2, $3, $4, $5, 'aws', $6, NULLIF($7, ''), $8)
`, uuid.NewString(), item.AssetType, item.Name, item.Status, item.Env, item.ExternalID, item.ExternalARN, rawTags)
		return err
	}

	_, err = s.db.ExecContext(ctx, `
UPDATE cmdb_asset
SET type = $2,
    name = $3,
    status = $4,
    env = $5,
    source = 'aws',
    external_arn = NULLIF($6, ''),
    tags = $7,
    deleted_at = NULL,
    updated_at = now()
WHERE id::text = $1
`, existingID, item.AssetType, item.Name, item.Status, item.Env, item.ExternalARN, rawTags)
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
