// Package workload turns observed weekly timetable lessons into a synthetic curriculum load.
package workload

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/istu-pro-dev/timetable/backend/internal/ingest/ttx"
	"github.com/istu-pro-dev/timetable/backend/internal/seed"
	"github.com/istu-pro-dev/timetable/backend/internal/store/db"
)

const (
	defaultGroupSize = 25
	currentIntake    = 2026
)

var intakePattern = regexp.MustCompile(`^[БСМГ](\d{2})`)

type memberKey struct {
	group    string
	division string
	part     int
}

type curriculumKey struct {
	discipline string
	teacher    string
	kind       string
	roomType   string
	audience   string
}

type loadCount struct {
	odd, even int
	audience  []memberKey
}

// FromBatch creates a versioned, editable synthetic curriculum from the first groupLimit
// groups (sorted by code) in one parsed timetable. Weekly/biweekly counts are inferred from
// the source parity markers; unknown group sizes and room capacities receive explicit defaults.
func FromBatch(batch *ttx.Batch, groupLimit int) (seed.PortableDataset, error) {
	if batch == nil || len(batch.Lessons) == 0 {
		return seed.PortableDataset{}, fmt.Errorf("source timetable has no lessons")
	}
	groupsByKey := make(map[string]ttx.Group, len(batch.Groups))
	groupKeys := make([]string, 0, len(batch.Groups))
	for _, group := range batch.Groups {
		if _, exists := groupsByKey[group.Key]; !exists {
			groupKeys = append(groupKeys, group.Key)
		}
		groupsByKey[group.Key] = group
	}
	slices.Sort(groupKeys)
	if groupLimit > 0 && len(groupKeys) > groupLimit {
		groupKeys = groupKeys[:groupLimit]
	}
	selected := make(map[string]bool, len(groupKeys))
	for _, key := range groupKeys {
		selected[key] = true
	}

	counts := map[curriculumKey]*loadCount{}
	teachers := map[string]bool{}
	disciplines := map[string]bool{}
	rooms := map[string]ttx.Room{}
	buildings := map[string]bool{}
	roomTypes := map[string]bool{}
	subgroupParts := map[string]map[int]bool{}
	roomAttendance := map[string]int{}
	selectedGroupSizes := make(map[string]int, len(selected))
	totalSubgroupParts := make(map[string]int)
	for _, key := range groupKeys {
		size := defaultGroupSize
		if group, ok := groupsByKey[key]; ok && group.Size != nil && *group.Size > 0 {
			size = *group.Size
		}
		selectedGroupSizes[key] = size
	}
	for _, lesson := range batch.Lessons {
		for _, audience := range lesson.Audience {
			if audience.Subgroup != nil && selected[audience.Group] {
				if subgroupParts[audience.Group] == nil {
					subgroupParts[audience.Group] = map[int]bool{}
				}
				subgroupParts[audience.Group][*audience.Subgroup] = true
			}
		}
	}
	for group, parts := range subgroupParts {
		totalSubgroupParts[group] = len(parts)
	}
	for _, lesson := range batch.Lessons {
		kind, ok := workloadKind(lesson.LessonType)
		if !ok || strings.TrimSpace(lesson.Discipline) == "" || len(lesson.Teachers) != 1 {
			continue
		}
		members := make([]memberKey, 0, len(lesson.Audience))
		attendanceByGroup := map[string]map[int]bool{}
		wholeGroups := map[string]bool{}
		for _, audience := range lesson.Audience {
			if !selected[audience.Group] {
				continue
			}
			member := memberKey{group: audience.Group}
			if audience.Subgroup != nil {
				member.division = "subgroup"
				member.part = *audience.Subgroup
				if attendanceByGroup[member.group] == nil {
					attendanceByGroup[member.group] = map[int]bool{}
				}
				attendanceByGroup[member.group][member.part] = true
			} else {
				wholeGroups[member.group] = true
			}
			if !slices.Contains(members, member) {
				members = append(members, member)
			}
		}
		if len(members) == 0 {
			continue
		}
		attendingStudents := 0
		for group := range wholeGroups {
			attendingStudents += selectedGroupSizes[group]
		}
		for group, parts := range attendanceByGroup {
			if wholeGroups[group] {
				continue
			}
			totalParts := max(totalSubgroupParts[group], 1)
			attendingStudents += (selectedGroupSizes[group]*len(parts) + totalParts - 1) / totalParts
		}
		slices.SortFunc(members, func(a, b memberKey) int {
			return strings.Compare(memberString(a), memberString(b))
		})
		roomType := fallbackRoomType(kind)
		if lesson.Room != "" {
			for _, room := range batch.Rooms {
				if room.Key == lesson.Room {
					rooms[room.Key] = room
					roomType = normalizeRoomType(room.Type)
					roomAttendance[room.Key] = max(roomAttendance[room.Key], attendingStudents)
					break
				}
			}
		}
		roomTypes[roomType] = true
		building := "?"
		for _, room := range batch.Rooms {
			if room.Key == lesson.Room {
				building = strings.TrimSpace(room.Building)
				break
			}
		}
		if lesson.Room != "" {
			buildings[building] = true
		}
		key := curriculumKey{
			discipline: strings.TrimSpace(lesson.Discipline), teacher: strings.TrimSpace(lesson.Teachers[0]),
			kind: kind, roomType: roomType, audience: audienceString(members),
		}
		count := counts[key]
		if count == nil {
			count = &loadCount{audience: members}
			counts[key] = count
		}
		switch lesson.Parity {
		case "every":
			count.odd++
			count.even++
		case "odd":
			count.odd++
		case "even":
			count.even++
		default:
			return seed.PortableDataset{}, fmt.Errorf("lesson %d has unsupported parity %q", lesson.ID, lesson.Parity)
		}
		teachers[key.teacher] = true
		disciplines[key.discipline] = true
	}
	if len(counts) == 0 {
		return seed.PortableDataset{}, fmt.Errorf("selected groups have no lecture, practice, or laboratory lessons with one teacher")
	}

	d := seed.PortableDataset{
		Format: seed.PortableFormat, Version: seed.PortableVersion, Name: "Синтетическая нагрузка ИТРиП",
		SemesterWeeks: seed.DefaultSemesterWeeks,
		TimeGrid:      seed.PortableTimeGrid{Days: 6, PeriodsPerDay: len(batch.Periods)},
		SourceNotes: []string{
			"Нагрузка агрегирована из расписания " + batch.Source.File + " по первым " + strconv.Itoa(len(groupKeys)) + " группам.",
			"Семестровые академические часы восстановлены по меткам чётности/нечётности исходного расписания при длительности семестра 18 учебных недель; одна пара равна двум академическим часам.",
			"Размер каждой группы принят равным 25 студентам; вместимость оценена по типу аудитории и увеличена до расчётной посещаемости из расписания.",
			"В набор включены лекции, практические и лабораторные занятия; зачёты, экзамены и записи без ровно одного преподавателя исключены.",
		},
	}
	for _, period := range batch.Periods {
		d.Periods = append(d.Periods, seed.PortablePeriod{Number: period.N, Start: period.Start, End: period.End})
	}

	roomTypeKeys := make([]string, 0, len(roomTypes))
	for roomType := range roomTypes {
		roomTypeKeys = append(roomTypeKeys, roomType)
	}
	slices.Sort(roomTypeKeys)
	for _, roomType := range roomTypeKeys {
		d.RoomTypes = append(d.RoomTypes, seed.PortableRoomType{Code: roomType, Name: roomTypeName(roomType)})
	}

	roomKeys := make([]string, 0, len(rooms))
	roomTypesWithRooms := map[string]bool{}
	for roomKey := range rooms {
		roomKeys = append(roomKeys, roomKey)
	}
	slices.Sort(roomKeys)
	for _, roomKey := range roomKeys {
		roomTypesWithRooms[normalizeRoomType(rooms[roomKey].Type)] = true
	}
	for _, roomType := range roomTypeKeys {
		if !roomTypesWithRooms[roomType] {
			buildings["synthetic"] = true
		}
	}
	if len(rooms) == 0 {
		buildings["synthetic"] = true
	}
	if len(buildings) == 0 {
		buildings["synthetic"] = true
	}
	buildingKeys := make([]string, 0, len(buildings))
	for building := range buildings {
		buildingKeys = append(buildingKeys, building)
	}
	slices.Sort(buildingKeys)
	buildingIDs := map[string]string{}
	for i, building := range buildingKeys {
		key := fmt.Sprintf("building-%d", i+1)
		buildingIDs[building] = key
		name := "Корпус " + building
		switch building {
		case "?":
			name = "Корпус не указан"
		case "synthetic":
			name = "Синтетический корпус"
		}
		d.Buildings = append(d.Buildings, seed.PortableBuilding{Key: key, Name: name})
	}
	for i, roomKey := range roomKeys {
		room := rooms[roomKey]
		building := strings.TrimSpace(room.Building)
		capacity := 0
		if room.Capacity != nil {
			capacity = *room.Capacity
		}
		capacity = max(capacity, defaultRoomCapacity(normalizeRoomType(room.Type)), roundCapacity(roomAttendance[roomKey]))
		d.Rooms = append(d.Rooms, seed.PortableRoom{
			Key: fmt.Sprintf("room-%d", i+1), Building: buildingIDs[building], Name: roomKey,
			Type: normalizeRoomType(room.Type), Capacity: capacity,
		})
	}
	for _, roomType := range roomTypeKeys {
		if roomTypesWithRooms[roomType] {
			continue
		}
		d.Rooms = append(d.Rooms, seed.PortableRoom{
			Key: "room-synthetic-" + roomType, Building: buildingIDs["synthetic"],
			Name: "Аудитория " + roomType, Type: roomType, Capacity: defaultRoomCapacity(roomType),
		})
	}

	groupIDs := map[string]bool{}
	for _, key := range groupKeys {
		group := groupsByKey[key]
		course := estimatedCourse(key)
		size := defaultGroupSize
		if group.Size != nil && *group.Size > 0 {
			size = *group.Size
		}
		d.Groups = append(d.Groups, seed.PortableGroup{Key: key, Course: course, Size: size})
		groupIDs[key] = true
		parts := make([]int, 0, len(subgroupParts[key]))
		for part := range subgroupParts[key] {
			parts = append(parts, part)
		}
		slices.Sort(parts)
		for _, part := range parts {
			subgroupSize := int(math.Ceil(float64(size) / float64(len(parts))))
			d.Subgroups = append(d.Subgroups, seed.PortableSubgroup{
				Group: key, Division: "subgroup", Part: part, Size: subgroupSize,
			})
		}
	}

	teacherKeys := sortedMapKeys(teachers)
	teacherIDs := make(map[string]string, len(teacherKeys))
	for i, teacher := range teacherKeys {
		key := fmt.Sprintf("teacher-%d", i+1)
		teacherIDs[teacher] = key
		d.Teachers = append(d.Teachers, seed.PortableTeacher{Key: key, FullName: teacher})
	}
	disciplineKeys := sortedMapKeys(disciplines)
	disciplineIDs := make(map[string]string, len(disciplineKeys))
	for i, discipline := range disciplineKeys {
		key := fmt.Sprintf("discipline-%d", i+1)
		disciplineIDs[discipline] = key
		d.Disciplines = append(d.Disciplines, seed.PortableDiscipline{Key: key, Name: discipline})
	}

	keys := make([]curriculumKey, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(a, b curriculumKey) int { return strings.Compare(keyString(a), keyString(b)) })
	for _, key := range keys {
		count := counts[key]
		weekly := min(count.odd, count.even)
		biweekly := abs(count.odd - count.even)
		if weekly+biweekly == 0 {
			continue
		}
		audience := make([]seed.PortableAudience, 0, len(count.audience))
		for _, member := range count.audience {
			if !groupIDs[member.group] {
				continue
			}
			audience = append(audience, seed.PortableAudience{
				Group: member.group, Division: member.division, Part: member.part,
			})
		}
		d.CurriculumItems = append(d.CurriculumItems, seed.PortableCurriculumItem{
			Discipline: disciplineIDs[key.discipline], Kind: kindForDB(key.kind), Teacher: teacherIDs[key.teacher],
			RoomType: key.roomType, SemesterHours: seed.ProjectedSemesterHours(weekly, biweekly, d.SemesterWeeks), Audience: audience,
		})
	}
	return d, nil
}

func workloadKind(source string) (string, bool) {
	switch source {
	case "lecture":
		return "lecture", true
	case "practice":
		return "seminar", true
	case "lab":
		return "lab", true
	default:
		return "", false
	}
}

func kindForDB(kind string) db.LessonKind {
	return db.LessonKind(kind)
}

func fallbackRoomType(kind string) string {
	switch kind {
	case "lab":
		return "lab"
	case "lecture":
		return "lecture"
	default:
		return "seminar"
	}
}

func normalizeRoomType(roomType string) string {
	roomType = strings.ToLower(strings.TrimSpace(roomType))
	if roomType == "" {
		return "general"
	}
	return roomType
}

func roomTypeName(roomType string) string {
	switch roomType {
	case "lecture":
		return "Лекционная аудитория"
	case "seminar", "general":
		return "Аудитория для практических занятий"
	case "lab":
		return "Лаборатория"
	case "computer":
		return "Компьютерный класс"
	case "sport":
		return "Спортивный зал"
	case "special":
		return "Специализированная аудитория"
	default:
		return "Аудитория (" + roomType + ")"
	}
}

func defaultRoomCapacity(roomType string) int {
	switch roomType {
	case "lecture", "general", "special":
		return 60
	case "computer":
		return 25
	case "sport":
		return 100
	case "lab":
		return 20
	default:
		return 30
	}
}

func roundCapacity(n int) int {
	if n <= 0 {
		return 0
	}
	return (n + 9) / 10 * 10
}

func estimatedCourse(group string) int {
	match := intakePattern.FindStringSubmatch(strings.ToUpper(group))
	if match == nil {
		return 1
	}
	intake, _ := strconv.Atoi(match[1])
	year := 2000 + intake
	course := currentIntake - year + 1
	if course < 1 {
		return 1
	}
	return min(course, 6)
}

func memberString(member memberKey) string {
	return fmt.Sprintf("%s/%s/%d", member.group, member.division, member.part)
}

func audienceString(members []memberKey) string {
	parts := make([]string, len(members))
	for i, member := range members {
		parts[i] = memberString(member)
	}
	return strings.Join(parts, ",")
}

func keyString(key curriculumKey) string {
	return strings.Join([]string{key.discipline, key.teacher, key.kind, key.roomType, key.audience}, "\x00")
}

func sortedMapKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
