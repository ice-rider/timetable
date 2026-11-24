package seed

import (
	"fmt"
	"strings"

	"github.com/istu-pro-dev/timetable/backend/internal/store/db"
)

// PortableFormat is the format name used by dataset dump files.
const PortableFormat = "timetable-dataset"

// PortableVersion is the current supported dump schema version.
const PortableVersion = 2

// DefaultSemesterWeeks is the default number of teaching weeks in a semester.
const DefaultSemesterWeeks = 18

// PortableDataset is the editable JSON exchange format for a timetable planning dataset.
type PortableDataset struct {
	Format          string                        `json:"format"`
	Version         int                           `json:"version"`
	Name            string                        `json:"name,omitempty"`
	SourceNotes     []string                      `json:"source_notes,omitempty"`
	SemesterWeeks   int                           `json:"semester_weeks"`
	TimeGrid        PortableTimeGrid              `json:"time_grid"`
	Periods         []PortablePeriod              `json:"periods"`
	RoomTypes       []PortableRoomType            `json:"room_types"`
	Buildings       []PortableBuilding            `json:"buildings"`
	Rooms           []PortableRoom                `json:"rooms"`
	Groups          []PortableGroup               `json:"groups"`
	Subgroups       []PortableSubgroup            `json:"subgroups"`
	Teachers        []PortableTeacher             `json:"teachers"`
	Disciplines     []PortableDiscipline          `json:"disciplines"`
	TeacherAvail    []PortableTeacherAvailability `json:"teacher_availability,omitempty"`
	RoomAvail       []PortableRoomAvailability    `json:"room_availability,omitempty"`
	CurriculumItems []PortableCurriculumItem      `json:"curriculum_items"`
}

// PortableTimeGrid describes the weekly timetable grid.
type PortableTimeGrid struct {
	Days          int `json:"days"`
	PeriodsPerDay int `json:"periods_per_day"`
}

// PortablePeriod describes a period in the bell schedule.
type PortablePeriod struct {
	Number int    `json:"number"`
	Start  string `json:"start"`
	End    string `json:"end"`
}

// PortableRoomType describes a schedulable room category.
type PortableRoomType struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// PortableBuilding describes a campus building with a stable import key.
type PortableBuilding struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Address string `json:"address,omitempty"`
}

// PortableRoom describes a room and references its building and type by key.
type PortableRoom struct {
	Key      string `json:"key"`
	Building string `json:"building"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Capacity int    `json:"capacity"`
}

// PortableGroup describes a student group.
type PortableGroup struct {
	Key    string `json:"key"`
	Course int    `json:"course"`
	Size   int    `json:"size"`
}

// PortableSubgroup describes a division and part of a group.
type PortableSubgroup struct {
	Group    string `json:"group"`
	Division string `json:"division"`
	Part     int    `json:"part"`
	Size     int    `json:"size"`
}

// PortableTeacher describes a teacher with a stable import key.
type PortableTeacher struct {
	Key       string `json:"key"`
	FullName  string `json:"full_name"`
	ShortName string `json:"short_name,omitempty"`
}

// PortableDiscipline describes a subject with a stable import key.
type PortableDiscipline struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

// PortableTeacherAvailability stores one availability exception.
type PortableTeacherAvailability struct {
	Teacher string          `json:"teacher"`
	Day     int             `json:"day"`
	Period  int             `json:"period"`
	Parity  db.Parity       `json:"parity"`
	Status  db.Availability `json:"status"`
}

// PortableRoomAvailability stores one room availability exception.
type PortableRoomAvailability struct {
	Room   string          `json:"room"`
	Day    int             `json:"day"`
	Period int             `json:"period"`
	Parity db.Parity       `json:"parity"`
	Status db.Availability `json:"status"`
}

// PortableAudience points a curriculum item at a group or subgroup.
type PortableAudience struct {
	Group    string `json:"group"`
	Division string `json:"division,omitempty"`
	Part     int    `json:"part,omitempty"`
}

// PortableCurriculumItem describes a subject's academic-hour load for one semester.
type PortableCurriculumItem struct {
	Discipline    string             `json:"discipline"`
	Kind          db.LessonKind      `json:"kind"`
	Teacher       string             `json:"teacher"`
	RoomType      string             `json:"room_type"`
	SemesterHours int                `json:"semester_hours"`
	Audience      []PortableAudience `json:"audience"`
}

// ToDataset validates references and converts the portable names/keys into the indexed
// representation used by the transactional seed loader.
func (p PortableDataset) ToDataset() (*Dataset, error) {
	if p.Format != PortableFormat || p.Version != PortableVersion {
		return nil, fmt.Errorf("unsupported dataset format/version: %q/%d", p.Format, p.Version)
	}
	if p.TimeGrid.Days < 1 || p.TimeGrid.Days > 7 || p.TimeGrid.PeriodsPerDay < 1 || p.TimeGrid.PeriodsPerDay > 16 {
		return nil, fmt.Errorf("time_grid days and periods_per_day must be between 1..7 and 1..16")
	}
	if p.SemesterWeeks < 1 || p.SemesterWeeks > 52 {
		return nil, fmt.Errorf("semester_weeks must be between 1 and 52")
	}
	d := &Dataset{Days: p.TimeGrid.Days, PeriodsPerDay: p.TimeGrid.PeriodsPerDay}
	for _, v := range p.Periods {
		if v.Number != len(d.Periods)+1 {
			return nil, fmt.Errorf("period numbers must be sequential starting at 1")
		}
		start, err := clockMinutes(v.Start)
		if err != nil {
			return nil, fmt.Errorf("period %d start: %w", v.Number, err)
		}
		end, err := clockMinutes(v.End)
		if err != nil || end <= start {
			return nil, fmt.Errorf("period %d end must be a valid time after start", v.Number)
		}
		d.Periods = append(d.Periods, Period{Number: v.Number, Start: start, End: end})
	}
	if len(d.Periods) != d.PeriodsPerDay {
		return nil, fmt.Errorf("periods must contain exactly %d entries", d.PeriodsPerDay)
	}

	roomTypeIndex := map[string]int{}
	for _, v := range p.RoomTypes {
		if strings.TrimSpace(v.Code) == "" || strings.TrimSpace(v.Name) == "" {
			return nil, fmt.Errorf("room types require code and name")
		}
		if _, exists := roomTypeIndex[v.Code]; exists {
			return nil, fmt.Errorf("duplicate room type %q", v.Code)
		}
		roomTypeIndex[v.Code] = len(d.RoomTypes)
		d.RoomTypes = append(d.RoomTypes, RoomType(v))
	}

	buildingIndex := map[string]int{}
	for _, v := range p.Buildings {
		if err := addPortableKey(buildingIndex, v.Key, len(d.Buildings), "building"); err != nil {
			return nil, err
		}
		if strings.TrimSpace(v.Name) == "" {
			return nil, fmt.Errorf("building %q name cannot be empty", v.Key)
		}
		d.Buildings = append(d.Buildings, Building{Name: v.Name, Address: v.Address})
	}
	roomIndex := map[string]int{}
	for _, v := range p.Rooms {
		if err := addPortableKey(roomIndex, v.Key, len(d.Rooms), "room"); err != nil {
			return nil, err
		}
		b, ok := buildingIndex[v.Building]
		if !ok {
			return nil, fmt.Errorf("room %q references unknown building %q", v.Key, v.Building)
		}
		if _, ok := roomTypeIndex[v.Type]; !ok {
			return nil, fmt.Errorf("room %q references unknown type %q", v.Key, v.Type)
		}
		if v.Capacity <= 0 {
			return nil, fmt.Errorf("room %q capacity must be positive", v.Key)
		}
		if strings.TrimSpace(v.Name) == "" {
			return nil, fmt.Errorf("room %q name cannot be empty", v.Key)
		}
		d.Rooms = append(d.Rooms, Room{Building: b, Name: v.Name, Type: v.Type, Capacity: v.Capacity})
	}
	groupIndex := map[string]int{}
	for _, v := range p.Groups {
		if err := addPortableKey(groupIndex, v.Key, len(d.Groups), "group"); err != nil {
			return nil, err
		}
		if strings.TrimSpace(v.Key) == "" || v.Course < 0 || v.Size < 0 {
			return nil, fmt.Errorf("group %q requires a name and non-negative course and size", v.Key)
		}
		d.Groups = append(d.Groups, Group{Name: v.Key, Course: v.Course, Size: v.Size})
	}
	subgroupIndex := map[string]bool{}
	for _, v := range p.Subgroups {
		g, ok := groupIndex[v.Group]
		if !ok || v.Division == "" || v.Part < 1 || v.Size < 0 {
			return nil, fmt.Errorf("invalid subgroup %q/%s/%d", v.Group, v.Division, v.Part)
		}
		key := fmt.Sprintf("%d/%s/%d", g, v.Division, v.Part)
		if subgroupIndex[key] {
			return nil, fmt.Errorf("duplicate subgroup %q/%s/%d", v.Group, v.Division, v.Part)
		}
		subgroupIndex[key] = true
		d.Subgroups = append(d.Subgroups, Subgroup{Group: g, Division: v.Division, Part: v.Part, Size: v.Size})
	}
	teacherIndex := map[string]int{}
	for _, v := range p.Teachers {
		if err := addPortableKey(teacherIndex, v.Key, len(d.Teachers), "teacher"); err != nil {
			return nil, err
		}
		if strings.TrimSpace(v.FullName) == "" {
			return nil, fmt.Errorf("teacher %q full_name cannot be empty", v.Key)
		}
		d.Teachers = append(d.Teachers, Teacher{FullName: v.FullName, ShortName: v.ShortName})
	}
	disciplineIndex := map[string]int{}
	for _, v := range p.Disciplines {
		if err := addPortableKey(disciplineIndex, v.Key, len(d.Disciplines), "discipline"); err != nil {
			return nil, err
		}
		if strings.TrimSpace(v.Name) == "" {
			return nil, fmt.Errorf("discipline %q name cannot be empty", v.Key)
		}
		d.Disciplines = append(d.Disciplines, v.Name)
	}
	for _, v := range p.TeacherAvail {
		t, ok := teacherIndex[v.Teacher]
		if !ok {
			return nil, fmt.Errorf("teacher availability references unknown teacher %q", v.Teacher)
		}
		if err := validatePortableAvailability(v.Day, v.Period, v.Parity, v.Status, d); err != nil {
			return nil, err
		}
		d.TeacherAvail = append(d.TeacherAvail, TeacherAvailability{Teacher: t, Day: v.Day, Period: v.Period, Parity: v.Parity, Status: v.Status})
	}
	for _, v := range p.RoomAvail {
		r, ok := roomIndex[v.Room]
		if !ok {
			return nil, fmt.Errorf("room availability references unknown room %q", v.Room)
		}
		if err := validatePortableAvailability(v.Day, v.Period, v.Parity, v.Status, d); err != nil {
			return nil, err
		}
		d.RoomAvail = append(d.RoomAvail, RoomAvailability{Room: r, Day: v.Day, Period: v.Period, Parity: v.Parity, Status: v.Status})
	}
	for i, v := range p.CurriculumItems {
		disc, hasDisc := disciplineIndex[v.Discipline]
		teacher, hasTeacher := teacherIndex[v.Teacher]
		if !hasDisc || !hasTeacher {
			return nil, fmt.Errorf("curriculum_items[%d] references unknown discipline or teacher", i)
		}
		if !v.Kind.Valid() {
			return nil, fmt.Errorf("curriculum_items[%d] kind must be lecture, seminar, or lab", i)
		}
		if _, ok := roomTypeIndex[v.RoomType]; !ok {
			return nil, fmt.Errorf("curriculum_items[%d] references unknown room_type %q", i, v.RoomType)
		}
		weekly, biweekly, err := ProjectSemesterHours(v.SemesterHours, p.SemesterWeeks)
		if err != nil {
			return nil, fmt.Errorf("curriculum_items[%d]: %w", i, err)
		}
		it := Item{Discipline: disc, Kind: v.Kind, Teacher: teacher, RoomType: v.RoomType, Weekly: weekly, Biweekly: biweekly}
		seenAudience := map[string]bool{}
		for _, member := range v.Audience {
			g, ok := groupIndex[member.Group]
			if !ok {
				return nil, fmt.Errorf("curriculum_items[%d] references unknown group %q", i, member.Group)
			}
			switch {
			case member.Division == "" && member.Part != 0:
				return nil, fmt.Errorf("curriculum_items[%d] whole-group audience part must be 0", i)
			case member.Division != "" && member.Part < 1:
				return nil, fmt.Errorf("curriculum_items[%d] subgroup audience requires part >= 1", i)
			case member.Division != "" && !subgroupIndex[fmt.Sprintf("%d/%s/%d", g, member.Division, member.Part)]:
				return nil, fmt.Errorf("curriculum_items[%d] references undefined subgroup %s/%s/%d", i, member.Group, member.Division, member.Part)
			}
			memberKey := fmt.Sprintf("%d/%s/%d", g, member.Division, member.Part)
			if seenAudience[memberKey] {
				return nil, fmt.Errorf("curriculum_items[%d] has duplicate audience members", i)
			}
			seenAudience[memberKey] = true
			it.Audience = append(it.Audience, Member{Group: g, Division: member.Division, Part: member.Part})
		}
		if len(it.Audience) == 0 {
			return nil, fmt.Errorf("curriculum_items[%d] audience cannot be empty", i)
		}
		d.Items = append(d.Items, it)
	}
	if len(d.Buildings) == 0 || len(d.RoomTypes) == 0 || len(d.Rooms) == 0 ||
		len(d.Groups) == 0 || len(d.Teachers) == 0 || len(d.Disciplines) == 0 || len(d.Items) == 0 {
		return nil, fmt.Errorf("dataset must include room types, buildings, rooms, groups, teachers, disciplines, and curriculum_items")
	}
	return d, nil
}

// PortableFromDataset creates a key-based JSON document from the demo dataset.
func PortableFromDataset(d *Dataset, name string) PortableDataset {
	p := PortableDataset{
		Format: PortableFormat, Version: PortableVersion, Name: name,
		SemesterWeeks: DefaultSemesterWeeks,
		TimeGrid:      PortableTimeGrid{Days: d.Days, PeriodsPerDay: d.PeriodsPerDay},
	}
	for _, v := range d.Periods {
		p.Periods = append(p.Periods, PortablePeriod{Number: v.Number, Start: clockString(v.Start), End: clockString(v.End)})
	}
	for _, v := range d.RoomTypes {
		p.RoomTypes = append(p.RoomTypes, PortableRoomType(v))
	}
	for i, v := range d.Buildings {
		p.Buildings = append(p.Buildings, PortableBuilding{Key: fmt.Sprintf("building-%d", i+1), Name: v.Name, Address: v.Address})
	}
	for i, v := range d.Rooms {
		p.Rooms = append(p.Rooms, PortableRoom{
			Key: fmt.Sprintf("room-%d", i+1), Building: fmt.Sprintf("building-%d", v.Building+1),
			Name: v.Name, Type: v.Type, Capacity: v.Capacity,
		})
	}
	for _, v := range d.Groups {
		p.Groups = append(p.Groups, PortableGroup{Key: v.Name, Course: v.Course, Size: v.Size})
	}
	for _, v := range d.Subgroups {
		p.Subgroups = append(p.Subgroups, PortableSubgroup{
			Group: d.Groups[v.Group].Name, Division: v.Division, Part: v.Part, Size: v.Size,
		})
	}
	for i, v := range d.Teachers {
		p.Teachers = append(p.Teachers, PortableTeacher{
			Key: fmt.Sprintf("teacher-%d", i+1), FullName: v.FullName, ShortName: v.ShortName,
		})
	}
	for i, v := range d.Disciplines {
		p.Disciplines = append(p.Disciplines, PortableDiscipline{Key: fmt.Sprintf("discipline-%d", i+1), Name: v})
	}
	for _, v := range d.TeacherAvail {
		p.TeacherAvail = append(p.TeacherAvail, PortableTeacherAvailability{
			Teacher: fmt.Sprintf("teacher-%d", v.Teacher+1), Day: v.Day, Period: v.Period,
			Parity: v.Parity, Status: v.Status,
		})
	}
	for _, v := range d.RoomAvail {
		p.RoomAvail = append(p.RoomAvail, PortableRoomAvailability{
			Room: fmt.Sprintf("room-%d", v.Room+1), Day: v.Day, Period: v.Period,
			Parity: v.Parity, Status: v.Status,
		})
	}
	for _, v := range d.Items {
		audience := make([]PortableAudience, 0, len(v.Audience))
		for _, m := range v.Audience {
			audience = append(audience, PortableAudience{
				Group: d.Groups[m.Group].Name, Division: m.Division, Part: m.Part,
			})
		}
		p.CurriculumItems = append(p.CurriculumItems, PortableCurriculumItem{
			Discipline: fmt.Sprintf("discipline-%d", v.Discipline+1), Kind: v.Kind,
			Teacher: fmt.Sprintf("teacher-%d", v.Teacher+1), RoomType: v.RoomType,
			SemesterHours: (2*v.Weekly + v.Biweekly) * p.SemesterWeeks, Audience: audience,
		})
	}
	return p
}

// ProjectSemesterHours maps semester academic hours to supported weekly and alternating pairs.
// One weekly pair is two academic hours each teaching week; one alternating pair is one
// academic hour per teaching week on average. Non-exact totals are rounded to the nearest
// supported schedule frequency.
func ProjectSemesterHours(hours, semesterWeeks int) (weekly, biweekly int, err error) {
	if semesterWeeks < 1 || semesterWeeks > 52 {
		return 0, 0, fmt.Errorf("semester_weeks must be between 1 and 52")
	}
	if hours < 1 || hours > 40*semesterWeeks {
		return 0, 0, fmt.Errorf("semester_hours must be between 1 and %d", 40*semesterWeeks)
	}
	hourUnits := (hours + semesterWeeks/2) / semesterWeeks
	weekly, biweekly = hourUnits/2, hourUnits%2
	if weekly > 20 {
		return 0, 0, fmt.Errorf("semester_hours exceed the supported maximum schedule load")
	}
	return weekly, biweekly, nil
}

// ProjectedSemesterHours returns the semester hours represented by weekly/alternating pairs.
func ProjectedSemesterHours(weekly, biweekly, semesterWeeks int) int {
	return (2*weekly + biweekly) * semesterWeeks
}

func addPortableKey(index map[string]int, key string, value int, kind string) error {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return fmt.Errorf("%s key cannot be empty", kind)
	}
	if trimmed != key {
		return fmt.Errorf("%s key %q must not have surrounding whitespace", kind, key)
	}
	if _, exists := index[trimmed]; exists {
		return fmt.Errorf("duplicate %s key %q", kind, key)
	}
	index[trimmed] = value
	return nil
}

func validatePortableAvailability(day, period int, parity db.Parity, status db.Availability, d *Dataset) error {
	if day < 0 || day >= d.Days || period < 1 || period > d.PeriodsPerDay {
		return fmt.Errorf("availability day or period is outside the time grid")
	}
	if parity != db.ParityEvery && parity != db.ParityOdd && parity != db.ParityEven {
		return fmt.Errorf("availability parity must be every, odd, or even")
	}
	if !status.Valid() {
		return fmt.Errorf("availability status must be preferred, undesired, or unavailable")
	}
	return nil
}

func clockMinutes(s string) (int, error) {
	var h, m int
	if _, err := fmt.Sscanf(s, "%d:%d", &h, &m); err != nil || h < 0 || h > 23 || m < 0 || m > 59 || len(s) != 5 {
		return 0, fmt.Errorf("must be HH:MM")
	}
	return h*60 + m, nil
}

func clockString(minutes int) string {
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}
