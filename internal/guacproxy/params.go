package guacproxy

import (
	"strconv"
	"strings"
)

// RDPParams carries the RDP connection parameters that the Go side injects
// into the Guacamole handshake. Only the fields that vary per-asset/per-client
// are modelled here; sensible defaults cover the rest.
type RDPParams struct {
	Hostname   string
	Port       int
	Username   string
	Password   string
	Domain     string
	Security   string // "any" | "nla" | "tls" | "rdp"
	IgnoreCert bool

	Width    int
	Height   int
	DPI      int
	Timezone string

	EnableWallpaper          bool
	EnableTheming            bool
	EnableFontSmoothing      bool
	EnableFullWindowDrag     bool
	EnableDesktopComposition bool
	EnableMenuAnimations     bool
}

func (p RDPParams) value(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "hostname":
		return p.Hostname
	case "port":
		if p.Port > 0 {
			return strconv.Itoa(p.Port)
		}
		return "3389"
	case "username":
		return p.Username
	case "password":
		return p.Password
	case "domain":
		return p.Domain
	case "security":
		if p.Security != "" {
			return p.Security
		}
		return "any"
	case "ignore-cert":
		return boolStr(p.IgnoreCert)
	case "disable-auth":
		return ""
	case "width":
		if p.Width > 0 {
			return strconv.Itoa(p.Width)
		}
		return "1280"
	case "height":
		if p.Height > 0 {
			return strconv.Itoa(p.Height)
		}
		return "720"
	case "dpi":
		if p.DPI > 0 {
			return strconv.Itoa(p.DPI)
		}
		return "96"
	case "timezone":
		if p.Timezone != "" {
			return p.Timezone
		}
		return "UTC"
	case "color-depth":
		return "24"
	case "resize-method":
		return "display-update"
	case "enable-wallpaper":
		return boolOrEmpty(p.EnableWallpaper)
	case "enable-theming":
		return boolOrEmpty(p.EnableTheming)
	case "enable-font-smoothing":
		return boolOrEmpty(p.EnableFontSmoothing)
	case "enable-full-window-drag":
		return boolOrEmpty(p.EnableFullWindowDrag)
	case "enable-desktop-composition":
		return boolOrEmpty(p.EnableDesktopComposition)
	case "enable-menu-animations":
		return boolOrEmpty(p.EnableMenuAnimations)
	case "enable-audio-input":
		return ""
	case "disable-audio":
		return "true"
	case "disable-copy", "disable-paste", "disable-download", "disable-upload":
		return ""
	case "read-only":
		return ""
	default:
		return ""
	}
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func boolOrEmpty(b bool) string {
	if b {
		return "true"
	}
	return ""
}
