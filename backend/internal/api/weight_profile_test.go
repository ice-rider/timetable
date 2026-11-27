package api

import (
	"testing"

	"github.com/istu-pro-dev/timetable/backend/internal/engine/soft"
)

func TestToSoftWeights(t *testing.T) {
	m := map[string]float64{"gaps": 10, "edge_slots": 1, "unknown": 99}
	w := toSoftWeights(m)
	if w[soft.Gaps] != 10 {
		t.Fatalf("gaps = %v", w[soft.Gaps])
	}
	if w[soft.EdgeSlots] != 1 {
		t.Fatalf("edge_slots = %v", w[soft.EdgeSlots])
	}
	if w[soft.BuildingTransitions] != soft.DefaultWeights()[soft.BuildingTransitions] {
		t.Fatalf("default leaked: %v", w[soft.BuildingTransitions])
	}
}

func TestWeightProfileInputValidate(t *testing.T) {
	cases := []struct {
		name string
		in   weightProfileInput
		ok   bool
	}{
		{"ok", weightProfileInput{Name: "p", Weights: map[string]float64{"gaps": 5}}, true},
		{"empty name", weightProfileInput{Name: "", Weights: map[string]float64{"gaps": 5}}, false},
		{"empty weights", weightProfileInput{Name: "p", Weights: map[string]float64{}}, false},
		{"unknown key", weightProfileInput{Name: "p", Weights: map[string]float64{"nope": 1}}, false},
		{"negative", weightProfileInput{Name: "p", Weights: map[string]float64{"gaps": -1}}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.in.validate()
			if (err == nil) != c.ok {
				t.Fatalf("err = %v, ok = %v", err, c.ok)
			}
		})
	}
}
