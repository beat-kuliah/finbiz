package platform

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// ApiError is a structured API error with an HTTP status.
type ApiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Status  int    `json:"-"`
}

func (e *ApiError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// NewApiError constructs an ApiError.
func NewApiError(status int, code, message string) *ApiError {
	return &ApiError{Code: code, Message: message, Status: status}
}

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WriteError writes `{error:{code,message}}` with the given status.
func WriteError(w http.ResponseWriter, err *ApiError) {
	if err == nil {
		err = NewApiError(http.StatusInternalServerError, "internal_error", "internal error")
	}
	status := err.Status
	if status == 0 {
		status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorEnvelope{
		Error: errorBody{Code: err.Code, Message: err.Message},
	})
}
