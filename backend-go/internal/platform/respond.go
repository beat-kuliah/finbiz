package platform

import (
	"encoding/json"
	"net/http"
)

// JSON writes v as a JSON response with the given status code.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	_ = json.NewEncoder(w).Encode(v)
}

// JSONError writes an ApiError as `{error:{code,message}}`.
func JSONError(w http.ResponseWriter, err *ApiError) {
	WriteError(w, err)
}
