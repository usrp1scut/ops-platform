package awssync

import (
	"context"
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

	awsrepo "ops-platform/internal/aws"
	"ops-platform/internal/config"
)

const (
	resourceEC2 = "ec2_instance"
	resourceVPC = "vpc"
	resourceSG  = "security_group"
	resourceRDS = "rds_instance"
)

// VPCProxyReapplier reapplies bastion-proxy peer routing after a sync run.
// Implemented by cmdb.VPCProxyService; defined here so awssync can stay free
// of any dependency on the cmdb package's orchestration types.
type VPCProxyReapplier interface {
	ReapplyPropagation(ctx context.Context) error
}

type Service struct {
	cfg       config.Config
	accounts  *awsrepo.Repository
	writer    AssetWriter
	reapplier VPCProxyReapplier
	logger    *log.Logger
}

func NewService(cfg config.Config, accounts *awsrepo.Repository, writer AssetWriter, reapplier VPCProxyReapplier) *Service {
	return &Service{
		cfg:       cfg,
		accounts:  accounts,
		writer:    writer,
		reapplier: reapplier,
		logger:    log.New(log.Writer(), "aws-sync ", log.LstdFlags),
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

	if err := s.writer.LinkAWSRelations(ctx); err != nil {
		syncErr = errors.Join(syncErr, fmt.Errorf("sync relations: %w", err))
	}

	if s.reapplier != nil {
		if err := s.reapplier.ReapplyPropagation(ctx); err != nil {
			syncErr = errors.Join(syncErr, fmt.Errorf("reapply vpc proxy propagation: %w", err))
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

	var pending []*ec2.Instance
	imageIDs := make(map[string]struct{})

	input := &ec2.DescribeInstancesInput{}
	err := client.DescribeInstancesPagesWithContext(ctx, input, func(output *ec2.DescribeInstancesOutput, _ bool) bool {
		for _, reservation := range output.Reservations {
			for _, instance := range reservation.Instances {
				if instance == nil || awssdk.StringValue(instance.InstanceId) == "" {
					continue
				}
				pending = append(pending, instance)
				if id := awssdk.StringValue(instance.ImageId); id != "" {
					imageIDs[id] = struct{}{}
				}
			}
		}
		return true
	})
	if err != nil {
		syncErr = errors.Join(syncErr, err)
	}

	images := s.lookupEC2Images(ctx, client, imageIDs)

	for _, instance := range pending {
		externalID := awssdk.StringValue(instance.InstanceId)
		userTags := ec2TagsToMap(instance.Tags)
		zone := ""
		if instance.Placement != nil {
			zone = awssdk.StringValue(instance.Placement.AvailabilityZone)
		}
		subnetID := awssdk.StringValue(instance.SubnetId)
		vpcID := awssdk.StringValue(instance.VpcId)
		imageID := awssdk.StringValue(instance.ImageId)
		amiName, amiOwner := "", ""
		if meta, ok := images[imageID]; ok {
			amiName = meta.name
			amiOwner = meta.owner
		}
		osFamily := deriveOSFamily(amiOwner, amiName)
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
		if amiName != "" {
			sysTags["ami_name"] = amiName
		}
		if amiOwner != "" {
			sysTags["ami_owner_id"] = amiOwner
		}
		if osFamily != "" {
			sysTags["os_family"] = osFamily
		}
		asset := AssetUpsert{
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
			AMIName:      amiName,
			AMIOwnerID:   amiOwner,
			OSFamily:     osFamily,
			VPCID:        vpcID,
			SubnetID:     subnetID,
			KeyName:      awssdk.StringValue(instance.KeyName),
			Owner:        tagValue(userTags, "Owner"),
			BusinessUnit: tagValue(userTags, "BusinessUnit"),
			SystemTags:   sysTags,
			Labels:       userTags,
		}
		if err := s.writer.UpsertAsset(ctx, asset); err != nil {
			syncErr = errors.Join(syncErr, err)
			continue
		}
		count++
	}
	return count, syncErr
}

type amiMetadata struct {
	name  string
	owner string
}

func (s *Service) lookupEC2Images(ctx context.Context, client *ec2.EC2, ids map[string]struct{}) map[string]amiMetadata {
	result := make(map[string]amiMetadata, len(ids))
	if len(ids) == 0 {
		return result
	}
	all := make([]string, 0, len(ids))
	for id := range ids {
		all = append(all, id)
	}
	// DescribeImages has no published hard cap, but keep batches reasonable.
	const batchSize = 100
	for start := 0; start < len(all); start += batchSize {
		end := start + batchSize
		if end > len(all) {
			end = len(all)
		}
		batch := all[start:end]
		out, err := client.DescribeImagesWithContext(ctx, &ec2.DescribeImagesInput{
			ImageIds: awssdk.StringSlice(batch),
		})
		if err != nil {
			s.logger.Printf("describe images %d-%d: %v", start, end, err)
			continue
		}
		for _, img := range out.Images {
			if img == nil {
				continue
			}
			id := awssdk.StringValue(img.ImageId)
			if id == "" {
				continue
			}
			result[id] = amiMetadata{
				name:  awssdk.StringValue(img.Name),
				owner: awssdk.StringValue(img.OwnerId),
			}
		}
	}
	return result
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
			asset := AssetUpsert{
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
			if err := s.writer.UpsertAsset(ctx, asset); err != nil {
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
			asset := AssetUpsert{
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
			if err := s.writer.UpsertAsset(ctx, asset); err != nil {
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

			asset := AssetUpsert{
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
			if err := s.writer.UpsertAsset(ctx, asset); err != nil {
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
