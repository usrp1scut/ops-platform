// Package httpx provides shared HTTP response helpers.
//
// All delivery handlers should use WriteJSON / WriteError instead of defining
// their own copies. Centralized so error shape, encoding, and observability
// hooks can be evolved in one place.
package httpx

import (
	"encoding/json"
	"log"
	"net/http"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("httpx.WriteJSON: encode failed: %v", err)
	}
}

func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, ErrorResponse{Error: message})
}
