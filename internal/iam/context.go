package iam

import "context"

type contextKey string

const identityContextKey contextKey = "identity"

func WithIdentity(ctx context.Context, identity UserIdentity) context.Context {
	return context.WithValue(ctx, identityContextKey, identity)
}

func IdentityFromContext(ctx context.Context) (UserIdentity, bool) {
	value := ctx.Value(identityContextKey)
	if value == nil {
		return UserIdentity{}, false
	}
	identity, ok := value.(UserIdentity)
	return identity, ok
}
