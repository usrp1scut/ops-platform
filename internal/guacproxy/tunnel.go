package guacproxy

import (
	"io"
	"log"
	"net"

	"golang.org/x/crypto/ssh"
)

// sshForwarder listens on a local TCP port and forwards each accepted
// connection through an SSH proxy client to the fixed target address.
// The host advertised to clients is taken from advertiseHost — guacd must
// be able to resolve and reach it (in docker-compose, the ops-api service
// hostname works because both containers share a network).
type sshForwarder struct {
	ln            net.Listener
	advertiseAddr string
	sshClient     *ssh.Client
	targetAddr    string
	logger        *log.Logger
	done          chan struct{}
}

func newSSHForwarder(sshClient *ssh.Client, targetAddr, advertiseHost string, logger *log.Logger) (*sshForwarder, error) {
	ln, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		return nil, err
	}
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	fwd := &sshForwarder{
		ln:            ln,
		advertiseAddr: net.JoinHostPort(advertiseHost, port),
		sshClient:     sshClient,
		targetAddr:    targetAddr,
		logger:        logger,
		done:          make(chan struct{}),
	}
	go fwd.accept()
	return fwd, nil
}

func (f *sshForwarder) accept() {
	for {
		conn, err := f.ln.Accept()
		if err != nil {
			return
		}
		go f.handle(conn)
	}
}

func (f *sshForwarder) handle(local net.Conn) {
	defer local.Close()
	select {
	case <-f.done:
		return
	default:
	}
	remote, err := f.sshClient.Dial("tcp", f.targetAddr)
	if err != nil {
		if f.logger != nil {
			f.logger.Printf("rdp tunnel: dial %s via proxy failed: %v", f.targetAddr, err)
		}
		return
	}
	defer remote.Close()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(remote, local); done <- struct{}{} }()
	go func() { _, _ = io.Copy(local, remote); done <- struct{}{} }()
	<-done
}

func (f *sshForwarder) close() {
	select {
	case <-f.done:
		return
	default:
		close(f.done)
	}
	_ = f.ln.Close()
	_ = f.sshClient.Close()
}
