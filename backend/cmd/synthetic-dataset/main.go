// Package main creates a synthetic workload dataset from a supported timetable workbook.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/istu-pro-dev/timetable/backend/internal/ingest"
	"github.com/istu-pro-dev/timetable/backend/internal/workload"
)

func main() {
	input := flag.String("input", "", "path to a supported timetable workbook or ttx file")
	output := flag.String("output", "data/istu-synthetic-dataset.json", "output JSON path")
	groupLimit := flag.Int("groups", 12, "maximum number of groups to include (0 means all)")
	flag.Parse()
	if *input == "" {
		fmt.Fprintln(os.Stderr, "-input is required")
		os.Exit(2)
	}
	data, err := os.ReadFile(*input)
	if err != nil {
		fatal(err)
	}
	batch, err := ingest.Load(filepath.Base(*input), data)
	if err != nil {
		fatal(err)
	}
	dataset, err := workload.FromBatch(batch, *groupLimit)
	if err != nil {
		fatal(err)
	}
	if _, err := dataset.ToDataset(); err != nil {
		fatal(fmt.Errorf("generated dataset is invalid: %w", err))
	}
	encoded, err := json.MarshalIndent(dataset, "", "  ")
	if err != nil {
		fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(*output), 0o755); err != nil {
		fatal(err)
	}
	if err := os.WriteFile(*output, append(encoded, '\n'), 0o644); err != nil {
		fatal(err)
	}
	fmt.Printf(
		"Wrote %s: %d groups, %d teachers, %d rooms, %d disciplines, %d curriculum items\n",
		*output, len(dataset.Groups), len(dataset.Teachers), len(dataset.Rooms),
		len(dataset.Disciplines), len(dataset.CurriculumItems),
	)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
