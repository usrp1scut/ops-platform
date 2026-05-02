package guacproxy

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Instruction is a single Guacamole text-protocol instruction: an opcode
// followed by zero or more string arguments. On the wire each element is
// encoded as "LEN.VALUE" where LEN is the Unicode code-point count, elements
// are separated by "," and the instruction terminates with ";".
type Instruction struct {
	Opcode string
	Args   []string
}

// Encode renders the instruction on the Guacamole wire format.
func (ins Instruction) Encode() string {
	var b strings.Builder
	writeElem(&b, ins.Opcode)
	for _, a := range ins.Args {
		b.WriteByte(',')
		writeElem(&b, a)
	}
	b.WriteByte(';')
	return b.String()
}

func writeElem(b *strings.Builder, s string) {
	b.WriteString(strconv.Itoa(utf8.RuneCountInString(s)))
	b.WriteByte('.')
	b.WriteString(s)
}

// WriteInstruction writes an instruction to w.
func WriteInstruction(w io.Writer, ins Instruction) error {
	_, err := io.WriteString(w, ins.Encode())
	return err
}

// ReadInstruction reads one instruction from r. Returns io.EOF when the peer
// has cleanly closed the connection between instructions.
func ReadInstruction(r *bufio.Reader) (Instruction, error) {
	var ins Instruction
	first := true
	for {
		value, sep, err := readElement(r)
		if err != nil {
			return Instruction{}, err
		}
		if first {
			ins.Opcode = value
			first = false
		} else {
			ins.Args = append(ins.Args, value)
		}
		if sep == ';' {
			return ins, nil
		}
		if sep != ',' {
			return Instruction{}, fmt.Errorf("guacproxy: unexpected separator %q", sep)
		}
	}
}

// readElement reads one LEN.VALUE token plus the trailing separator.
func readElement(r *bufio.Reader) (string, rune, error) {
	lenStr, err := r.ReadString('.')
	if err != nil {
		return "", 0, err
	}
	lenStr = strings.TrimSuffix(lenStr, ".")
	n, err := strconv.Atoi(lenStr)
	if err != nil {
		return "", 0, fmt.Errorf("guacproxy: invalid length %q", lenStr)
	}
	if n < 0 {
		return "", 0, fmt.Errorf("guacproxy: negative length %d", n)
	}
	var sb strings.Builder
	for i := 0; i < n; i++ {
		ru, _, err := r.ReadRune()
		if err != nil {
			return "", 0, err
		}
		sb.WriteRune(ru)
	}
	sep, _, err := r.ReadRune()
	if err != nil {
		return "", 0, err
	}
	return sb.String(), sep, nil
}
