package platform

import "context"

type contextKey int

const (
	ctxUserID contextKey = iota + 1
	ctxEmail
	ctxScope
	ctxOrgID
	ctxOrgRole
)

func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, ctxUserID, userID)
}

func UserID(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxUserID).(string)
	return v, ok && v != ""
}

func WithEmail(ctx context.Context, email string) context.Context {
	return context.WithValue(ctx, ctxEmail, email)
}

func Email(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxEmail).(string)
	return v, ok && v != ""
}

func WithScope(ctx context.Context, scope string) context.Context {
	return context.WithValue(ctx, ctxScope, scope)
}

func Scope(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxScope).(string)
	return v, ok && v != ""
}

func WithOrgID(ctx context.Context, orgID string) context.Context {
	return context.WithValue(ctx, ctxOrgID, orgID)
}

func OrgID(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxOrgID).(string)
	return v, ok && v != ""
}

func WithOrgRole(ctx context.Context, role string) context.Context {
	return context.WithValue(ctx, ctxOrgRole, role)
}

func OrgRole(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxOrgRole).(string)
	return v, ok && v != ""
}
