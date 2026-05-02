package cmdb

import "strings"

// DefaultUsernameForOSFamily returns the conventional SSH login for the given
// os_family. Returns empty string for unknown families so callers can require
// an explicit override.
func DefaultUsernameForOSFamily(family string) string {
	switch strings.ToLower(strings.TrimSpace(family)) {
	case "amzn", "rhel", "suse":
		return "ec2-user"
	case "ubuntu":
		return "ubuntu"
	case "debian":
		return "admin"
	case "centos":
		return "centos"
	case "windows":
		return "Administrator"
	}
	return ""
}
