package guacproxy

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

// DialRDP opens a TCP connection to guacd and negotiates an RDP session using
// the given parameters. On success it returns a net.Conn ready for byte-level
// tunneling with the browser. Any leftover read-buffered bytes from the
// handshake phase are preserved in the returned connection's Read.
func DialRDP(ctx context.Context, guacdAddr string, params RDPParams) (net.Conn, error) {
	dialer := net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", guacdAddr)
	if err != nil {
		return nil, fmt.Errorf("dial guacd: %w", err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	}
	br := bufio.NewReader(conn)

	if err := WriteInstruction(conn, Instruction{Opcode: "select", Args: []string{"rdp"}}); err != nil {
		conn.Close()
		return nil, fmt.Errorf("send select: %w", err)
	}

	args, err := ReadInstruction(br)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("read args: %w", err)
	}
	if args.Opcode != "args" {
		conn.Close()
		return nil, fmt.Errorf("expected 'args' got %q", args.Opcode)
	}

	width := params.Width
	if width <= 0 {
		width = 1280
	}
	height := params.Height
	if height <= 0 {
		height = 720
	}
	dpi := params.DPI
	if dpi <= 0 {
		dpi = 96
	}
	timezone := params.Timezone
	if timezone == "" {
		timezone = "UTC"
	}

	for _, ins := range []Instruction{
		{Opcode: "size", Args: []string{strconv.Itoa(width), strconv.Itoa(height), strconv.Itoa(dpi)}},
		{Opcode: "audio", Args: []string{"audio/L16"}},
		{Opcode: "video"},
		{Opcode: "image", Args: []string{"image/png", "image/jpeg"}},
		{Opcode: "timezone", Args: []string{timezone}},
	} {
		if err := WriteInstruction(conn, ins); err != nil {
			conn.Close()
			return nil, fmt.Errorf("send %s: %w", ins.Opcode, err)
		}
	}

	values := make([]string, len(args.Args))
	for i, name := range args.Args {
		if strings.HasPrefix(name, "VERSION_") {
			values[i] = name
			continue
		}
		values[i] = params.value(name)
	}
	if err := WriteInstruction(conn, Instruction{Opcode: "connect", Args: values}); err != nil {
		conn.Close()
		return nil, fmt.Errorf("send connect: %w", err)
	}

	ready, err := ReadInstruction(br)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("read ready: %w", err)
	}
	switch ready.Opcode {
	case "ready":
		// ok
	case "error":
		conn.Close()
		return nil, fmt.Errorf("guacd error: %s", strings.Join(ready.Args, " "))
	default:
		conn.Close()
		return nil, fmt.Errorf("expected 'ready' got %q", ready.Opcode)
	}

	_ = conn.SetDeadline(time.Time{})
	return &bufferedConn{Conn: conn, r: br}, nil
}

// bufferedConn wraps a net.Conn together with a bufio.Reader that holds bytes
// already pulled from the socket during handshake.
type bufferedConn struct {
	net.Conn
	r *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) { return c.r.Read(p) }

// Reader exposes the underlying bufio.Reader so callers that want to parse
// incoming bytes as Guacamole instructions share the same buffer that
// holds any handshake-leftover data.
func (c *bufferedConn) Reader() *bufio.Reader { return c.r }
