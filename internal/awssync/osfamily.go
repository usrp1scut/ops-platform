package awssync

import "strings"

// Canonical AWS AMI owner IDs for the major distributions.
// Source: AWS public AMI docs; correct as of 2025.
const (
	amiOwnerAmazon    = "137112412989"
	amiOwnerCanonical = "099720109477"
	amiOwnerDebian    = "136693071363"
	amiOwnerRHEL      = "309956199498"
	amiOwnerSUSE      = "013907871322"
	amiOwnerCentOS    = "125523088429"
	amiOwnerAWSBackup = "591542846629" // AWS-managed Windows / various
	amiOwnerMicrosoft = "801119661308"
)

// deriveOSFamily returns a short os_family tag (amzn/ubuntu/debian/rhel/
// centos/suse/windows) from an AMI's owner account id and image name. Empty
// string means we couldn't classify it confidently.
func deriveOSFamily(ownerID, name string) string {
	name = strings.ToLower(strings.TrimSpace(name))

	switch strings.TrimSpace(ownerID) {
	case amiOwnerAmazon:
		if strings.Contains(name, "ubuntu") {
			return "ubuntu"
		}
		return "amzn"
	case amiOwnerCanonical:
		return "ubuntu"
	case amiOwnerDebian:
		return "debian"
	case amiOwnerRHEL:
		return "rhel"
	case amiOwnerSUSE:
		return "suse"
	case amiOwnerCentOS:
		return "centos"
	case amiOwnerMicrosoft, amiOwnerAWSBackup:
		if strings.Contains(name, "windows") {
			return "windows"
		}
	}

	switch {
	case strings.Contains(name, "amzn2") || strings.Contains(name, "amazon-linux") || strings.Contains(name, "al2023"):
		return "amzn"
	case strings.Contains(name, "ubuntu"):
		return "ubuntu"
	case strings.Contains(name, "debian"):
		return "debian"
	case strings.Contains(name, "rhel"):
		return "rhel"
	case strings.Contains(name, "centos"):
		return "centos"
	case strings.Contains(name, "suse") || strings.Contains(name, "sles"):
		return "suse"
	case strings.Contains(name, "windows"):
		return "windows"
	}

	return ""
}
