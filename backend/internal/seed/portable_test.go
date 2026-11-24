package seed

import (
	"reflect"
	"testing"
)

func TestPortableDatasetRoundTrip(t *testing.T) {
	original := Build()
	portable := PortableFromDataset(original, "demo")
	decoded, err := portable.ToDataset()
	if err != nil {
		t.Fatalf("ToDataset(): %v", err)
	}
	if got, want := decoded.Counts(), original.Counts(); got != want {
		t.Fatalf("round-trip counts = %+v, want %+v", got, want)
	}
	if !reflect.DeepEqual(decoded.Items[0], original.Items[0]) {
		t.Fatalf("first curriculum item = %+v, want %+v", decoded.Items[0], original.Items[0])
	}
}

func TestPortableDatasetRejectsUnknownReferences(t *testing.T) {
	portable := PortableFromDataset(Build(), "demo")
	portable.CurriculumItems[0].Teacher = "missing-teacher"
	if _, err := portable.ToDataset(); err == nil {
		t.Fatal("ToDataset() accepted an unknown teacher")
	}
}

func TestPortableDatasetRejectsUnsupportedVersion(t *testing.T) {
	portable := PortableFromDataset(Build(), "demo")
	portable.Version = 1
	if _, err := portable.ToDataset(); err == nil {
		t.Fatal("ToDataset() accepted an unsupported version")
	}
}

func TestProjectSemesterHours(t *testing.T) {
	tests := []struct {
		hours, weeks, weekly, biweekly int
	}{
		{36, 18, 1, 0},
		{18, 18, 0, 1},
		{54, 18, 1, 1},
		{72, 18, 2, 0},
		{36, 16, 1, 0},
		{40, 1, 20, 0},
		{2080, 52, 20, 0},
	}
	for _, tt := range tests {
		weekly, biweekly, err := ProjectSemesterHours(tt.hours, tt.weeks)
		if err != nil {
			t.Fatalf("ProjectSemesterHours(%d, %d): %v", tt.hours, tt.weeks, err)
		}
		if weekly != tt.weekly || biweekly != tt.biweekly {
			t.Errorf("ProjectSemesterHours(%d, %d) = (%d, %d), want (%d, %d)",
				tt.hours, tt.weeks, weekly, biweekly, tt.weekly, tt.biweekly)
		}
	}
}

func TestProjectSemesterHoursRejectsUnsupportedLoad(t *testing.T) {
	if _, _, err := ProjectSemesterHours(41, 1); err == nil {
		t.Fatal("ProjectSemesterHours() accepted more than 40 hours per week")
	}
	if _, _, err := ProjectSemesterHours(2081, 52); err == nil {
		t.Fatal("ProjectSemesterHours() accepted more than 2080 semester hours")
	}
}
