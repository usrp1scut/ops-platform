package aws

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/credentials/stscreds"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/sts"
)

func NewSessionForAccount(account SyncAccount, region string) (*session.Session, error) {
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

func TestAccountConnection(ctx context.Context, account SyncAccount) (ConnectionTestResult, error) {
	region := "us-east-1"
	for _, candidate := range account.RegionAllowlist {
		if strings.TrimSpace(candidate) != "" {
			region = strings.TrimSpace(candidate)
			break
		}
	}

	sess, err := NewSessionForAccount(account, region)
	if err != nil {
		return ConnectionTestResult{}, err
	}
	output, err := sts.New(sess, awssdk.NewConfig().WithRegion(region)).GetCallerIdentityWithContext(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		return ConnectionTestResult{}, err
	}
	return ConnectionTestResult{
		Status:    "ok",
		Region:    region,
		AccountID: awssdk.StringValue(output.Account),
		Arn:       awssdk.StringValue(output.Arn),
		UserID:    awssdk.StringValue(output.UserId),
		CheckedAt: time.Now(),
	}, nil
}
