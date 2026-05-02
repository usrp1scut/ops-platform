package cmdb

import (
	"reflect"
	"testing"
)

// PATCH /assets/:id has historically accepted "tags" as the label payload.
// CreateAsset already maps tags → labels; this regression covers UpdateAsset
// so older clients that send PATCH {"tags": ...} don't get a silent 200.
func TestApplyLabelsUpdate(t *testing.T) {
	cur := map[string]any{"existing": "v"}

	cases := []struct {
		name string
		req  UpdateAssetRequest
		want map[string]any
	}{
		{
			"both nil leaves current alone",
			UpdateAssetRequest{},
			cur,
		},
		{
			"labels takes precedence over tags",
			UpdateAssetRequest{Labels: map[string]any{"a": float64(1)}, Tags: map[string]any{"b": float64(2)}},
			map[string]any{"a": float64(1)},
		},
		{
			"tags fills in when labels missing (legacy clients)",
			UpdateAssetRequest{Tags: map[string]any{"b": float64(2)}},
			map[string]any{"b": float64(2)},
		},
		{
			"empty labels clears the map (distinct from nil)",
			UpdateAssetRequest{Labels: map[string]any{}},
			map[string]any{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := applyLabelsUpdate(cur, tc.req)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %#v, want %#v", got, tc.want)
			}
		})
	}
}
