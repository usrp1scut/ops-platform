package awssync

import "context"

// SourceID is the value written to cmdb_asset.source for every row produced
// by this syncer. Exported so the CMDB adapter (and future per-cloud
// uniqueness rules) reference one canonical constant rather than scattered
// string literals. Convention: each future cloud syncer package
// (`aliyunsync`, `azuresync`, `gcpsync`) exports the same name with its own
// value — keeps the multi-cloud onboarding mechanical.
const SourceID = "aws"

// AssetUpsert is the platform-agnostic vocabulary that the AWS sync emits for
// every observed resource. The CMDB adapter is responsible for translating it
// into the concrete cmdb_asset row (initial insert vs. update-with-merge).
type AssetUpsert struct {
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
	AMIName      string
	AMIOwnerID   string
	OSFamily     string
	VPCID        string
	SubnetID     string
	KeyName      string
	Owner        string
	BusinessUnit string
	SystemTags   map[string]any
	Labels       map[string]any
}

// AssetWriter is the port the sync service depends on. It hides every detail
// of how assets / relations are persisted, so awssync no longer reaches into
// the cmdb package or its tables.
type AssetWriter interface {
	// UpsertAsset stores or refreshes a single observed AWS resource.
	UpsertAsset(ctx context.Context, item AssetUpsert) error
	// LinkAWSRelations rebuilds in_vpc / in_subnet edges between AWS-source
	// assets after a sync round.
	LinkAWSRelations(ctx context.Context) error
}
