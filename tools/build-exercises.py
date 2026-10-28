"""Build data/exercises.json for the Gym tab.
Names are rewritten to the usual "Exercise (Equipment)" style; the ~120 most common get hand-picked names and a popularity rank.
Source: free-exercise-db by yuhonas (public domain, Unlicense): https://github.com/yuhonas/free-exercise-db
Usage: python3 tools/build-exercises.py path/to/exercises.json
Stretches are left out. Common gym names are added as search aliases, and a few popular
machine/cable movements the database lacks are added as extra entries (no photos)."""
import json, sys, re

src = json.load(open(sys.argv[1]))

ALIASES = {
    'Butterfly': 'pec deck, pec fly machine, chest fly machine',
    'Leverage Chest Press': 'chest press machine',
    'Leverage Incline Chest Press': 'incline chest press machine',
    'Leverage Shoulder Press': 'shoulder press machine',
    'Machine Shoulder (Military) Press': 'shoulder press machine',
    'Hack Squat': 'hack squat machine',
    'Leg Extensions': 'leg extension machine, quad extension',
    'Seated Leg Curl': 'leg curl machine, hamstring curl',
    'Lying Leg Curls': 'leg curl machine, hamstring curl',
    'Pullups': 'pull-up, pull up, chin',
    'Chin-Up': 'chin up, chinup',
    'Split Squat with Dumbbells': 'bulgarian split squat, rear foot elevated split squat',
    'Reverse Machine Flyes': 'rear delt fly machine, reverse pec deck',
    'Side Lateral Raise': 'lateral raise, side raise',
    'Seated Cable Rows': 'cable row, seated row, low row',
    'Barbell Hip Thrust': 'hip thrust',
    'Barbell Bench Press - Medium Grip': 'bench press, flat bench',
    'Barbell Incline Bench Press - Medium Grip': 'incline bench press',
    'Barbell Squat': 'back squat, squat',
    'Barbell Deadlift': 'deadlift, conventional deadlift',
    'Romanian Deadlift': 'rdl, stiff leg',
    'Wide-Grip Lat Pulldown': 'lat pulldown, pulldown',
    'Bent Over Barbell Row': 'barbell row',
    'Standing Calf Raises': 'calf raise machine, standing calf raise',
    'Triceps Pushdown - Rope Attachment': 'rope pushdown, tricep pushdown',
    'Dumbbell Bench Press': 'db bench, dumbbell bench',
    'Incline Dumbbell Press': 'incline db press, incline dumbbell bench',
    'Leg Press': 'leg press machine',
}

EXTRAS = [
    ('Hip Thrust (Machine)', ['glutes'], ['hamstrings'], 'machine'),
    ('Hip Abduction (Machine)', ['abductors'], ['glutes'], 'machine'),
    ('Hip Adduction (Machine)', ['adductors'], [], 'machine'),
    ('Pendulum Squat (Machine)', ['quadriceps'], ['glutes'], 'machine'),
    ('Belt Squat', ['quadriceps'], ['glutes', 'adductors'], 'machine'),
    ('Lateral Raise (Machine)', ['shoulders'], [], 'machine'),
    ('Lateral Raise (Cable, Standing)', ['shoulders'], [], 'cable'),
    ('Lat Pulldown (Machine)', ['lats'], ['biceps', 'middle back'], 'machine'),
    ('Seated Row (Machine)', ['middle back'], ['lats', 'biceps'], 'machine'),
    ('Chest-Supported Dumbbell Row', ['middle back'], ['lats', 'biceps', 'shoulders'], 'dumbbell'),
    ('Chest-Supported T-Bar Row', ['middle back'], ['lats', 'biceps'], 'machine'),
    ('Pullover (Machine)', ['lats'], ['chest'], 'machine'),
    ('Assisted Pull-Up (Machine)', ['lats'], ['biceps', 'middle back'], 'machine'),
    ('Assisted Dip (Machine)', ['triceps'], ['chest', 'shoulders'], 'machine'),
    ('Glute Kickback (Cable)', ['glutes'], ['hamstrings'], 'cable'),
    ('Glute Kickback (Machine)', ['glutes'], ['hamstrings'], 'machine'),
    ('Bayesian Curl (Cable)', ['biceps'], ['forearms'], 'cable'),
    ('Overhead Triceps Extension (Cable)', ['triceps'], [], 'cable'),
    ('Single-Arm Triceps Pushdown (Cable)', ['triceps'], [], 'cable'),
    ('Seated Calf Raise (Machine)', ['calves'], [], 'machine'),
    ('Leg Press (Horizontal)', ['quadriceps'], ['glutes', 'hamstrings'], 'machine'),
    ('Chest Fly (Cable, Standing)', ['chest'], ['shoulders'], 'cable'),
    ('Low-to-High Cable Fly', ['chest'], ['shoulders'], 'cable'),
    ('Rear Delt Fly (Cable)', ['shoulders'], ['middle back'], 'cable'),
    ('Shrug (Machine)', ['traps'], [], 'machine'),
    ('Back Extension (45°)', ['lower back'], ['glutes', 'hamstrings'], 'other'),
    ('Nordic Hamstring Curl', ['hamstrings'], [], 'body only'),
    ('Sissy Squat', ['quadriceps'], [], 'body only'),
]

# Most common gym exercises, most popular first, with standard "Exercise (Equipment)" names.
# Search and the picker show these before the rest.
POPULAR = [
    ('Barbell Bench Press - Medium Grip', 'Bench Press (Barbell)'), ('Barbell Squat', 'Squat (Barbell)'), ('Barbell Deadlift', 'Deadlift (Barbell)'),
    ('Wide-Grip Lat Pulldown', 'Lat Pulldown (Cable)'), ('Pullups', 'Pull Up'), ('Incline Dumbbell Press', 'Incline Bench Press (Dumbbell)'),
    ('Dumbbell Bench Press', 'Bench Press (Dumbbell)'), ('Seated Cable Rows', 'Seated Cable Row'), ('Bent Over Barbell Row', 'Bent Over Row (Barbell)'),
    ('One-Arm Dumbbell Row', 'Dumbbell Row'), ('Side Lateral Raise', 'Lateral Raise (Dumbbell)'), ('Dumbbell Bicep Curl', 'Bicep Curl (Dumbbell)'), ('Barbell Curl', 'Bicep Curl (Barbell)'), ('Hammer Curls', 'Hammer Curl (Dumbbell)'), ('Dumbbell Shoulder Press', 'Shoulder Press (Dumbbell)'),
    ('Barbell Shoulder Press', 'Overhead Press (Barbell)'), ('Leg Press', 'Leg Press (Machine)'), ('Romanian Deadlift', 'Romanian Deadlift (Barbell)'),
    ('Leg Extensions', 'Leg Extension (Machine)'), ('Lying Leg Curls', 'Lying Leg Curl (Machine)'), ('Seated Leg Curl', 'Seated Leg Curl (Machine)'),
    ('Barbell Hip Thrust', 'Hip Thrust (Barbell)'), ('Triceps Pushdown - Rope Attachment', 'Triceps Rope Pushdown'), ('Triceps Pushdown', 'Triceps Pushdown (Cable)'),
    ('Barbell Incline Bench Press - Medium Grip', 'Incline Bench Press (Barbell)'), ('Leverage Chest Press', 'Chest Press (Machine)'),
    ('Leverage Iso Row', 'Iso-Lateral Row (Machine)'), ('Leverage High Row', 'Iso-Lateral High Row (Machine)'), ('Butterfly', 'Pec Deck (Machine)'), ('Dumbbell Flyes', 'Chest Fly (Dumbbell)'),
    ('Face Pull', 'Face Pull (Cable)'), ('Chin-Up', 'Chin Up'), ('Pushups', 'Push Up'), ('Dips - Chest Version', 'Chest Dip'), ('Dips - Triceps Version', 'Triceps Dip'),
    ('Standing Calf Raises', 'Standing Calf Raise (Machine)'), ('Seated Calf Raise', 'Seated Calf Raise (Machine)'), ('Hack Squat', 'Hack Squat (Machine)'),
    ('Split Squat with Dumbbells', 'Split Squat (Dumbbell)'), ('Dumbbell Lunges', 'Lunge (Dumbbell)'), ('Goblet Squat', 'Goblet Squat'),
    ('Front Barbell Squat', 'Front Squat (Barbell)'), ('Leverage Shoulder Press', 'Shoulder Press (Machine)'), ('Machine Shoulder (Military) Press', 'Seated Shoulder Press (Machine)'),
    ('Reverse Machine Flyes', 'Rear Delt Fly (Machine)'), ('Cable Seated Lateral Raise', 'Seated Lateral Raise (Cable)'), ('Front Dumbbell Raise', 'Front Raise (Dumbbell)'),
    ('Arnold Dumbbell Press', 'Arnold Press (Dumbbell)'), ('Seated Dumbbell Press', 'Seated Shoulder Press (Dumbbell)'), ('Standing Military Press', 'Military Press (Barbell)'),
    ('Upright Barbell Row', 'Upright Row (Barbell)'), ('Barbell Shrug', 'Shrug (Barbell)'), ('Dumbbell Shrug', 'Shrug (Dumbbell)'),
    ('Close-Grip Front Lat Pulldown', 'Lat Pulldown - Close Grip (Cable)'), ('V-Bar Pulldown', 'Lat Pulldown - V Grip (Cable)'), ('Straight-Arm Pulldown', 'Straight Arm Pulldown (Cable)'),
    ('T-Bar Row with Handle', 'T-Bar Row'), ('Bent Over Two-Dumbbell Row', 'Bent Over Row (Dumbbell)'), ('Hyperextensions (Back Extensions)', 'Back Extension'),
    ('Cable Crossover', 'Cable Crossover'), ('Incline Dumbbell Flyes', 'Incline Chest Fly (Dumbbell)'),
    ('Decline Barbell Bench Press', 'Decline Bench Press (Barbell)'), ('Close-Grip Barbell Bench Press', 'Close Grip Bench Press (Barbell)'),
    ('Smith Machine Bench Press', 'Bench Press (Smith Machine)'), ('Smith Machine Incline Bench Press', 'Incline Bench Press (Smith Machine)'), ('Smith Machine Squat', 'Squat (Smith Machine)'),
    ('Leverage Incline Chest Press', 'Incline Chest Press (Machine)'), ('Machine Bench Press', 'Bench Press (Machine)'),
    ('Preacher Curl', 'Preacher Curl (Barbell)'), ('EZ-Bar Curl', 'Bicep Curl (EZ Bar)'), ('Standing Biceps Cable Curl', 'Bicep Curl (Cable)'),
    ('Cable Hammer Curls - Rope Attachment', 'Hammer Curl (Cable)'), ('Incline Dumbbell Curl', 'Incline Curl (Dumbbell)'), ('Concentration Curls', 'Concentration Curl (Dumbbell)'),
    ('Machine Bicep Curl', 'Bicep Curl (Machine)'), ('Machine Preacher Curls', 'Preacher Curl (Machine)'), ('EZ-Bar Skullcrusher', 'Skullcrusher (EZ Bar)'),
    ('Cable Rope Overhead Triceps Extension', 'Overhead Triceps Extension (Cable)'), ('Machine Triceps Extension', 'Triceps Extension (Machine)'), ('Bench Dips', 'Bench Dip'),
    ('Stiff-Legged Barbell Deadlift', 'Stiff Leg Deadlift (Barbell)'), ('Stiff-Legged Dumbbell Deadlift', 'Romanian Deadlift (Dumbbell)'), ('Barbell Walking Lunge', 'Walking Lunge (Barbell)'),
    ('Bodyweight Walking Lunge', 'Walking Lunge'), ('Barbell Glute Bridge', 'Glute Bridge (Barbell)'), ('Thigh Abductor', 'Hip Abduction (Machine)'), ('Thigh Adductor', 'Hip Adduction (Machine)'),
    ('Glute Ham Raise', 'Glute Ham Raise'), ('Smith Machine Calf Raise', 'Calf Raise (Smith Machine)'), ('Standing Barbell Calf Raise', 'Standing Calf Raise (Barbell)'),
    ('Crunches', 'Crunch'), ('Cable Crunch', 'Cable Crunch'), ('Ab Crunch Machine', 'Crunch (Machine)'), ('Hanging Leg Raise', 'Hanging Leg Raise'), ('Plank', 'Plank'),
    ('Russian Twist', 'Russian Twist'), ('Ab Roller', 'Ab Wheel'), ('Decline Crunch', 'Decline Crunch'),
    ('Rowing, Stationary', 'Rowing Machine'), ('Running, Treadmill', 'Treadmill'), ('Bicycling, Stationary', 'Exercise Bike'), ('Elliptical Trainer', 'Elliptical'),
    ('Stairmaster', 'Stair Climber'), ('Rope Jumping', 'Jump Rope'),
    ('Lying T-Bar Row', 'Chest Supported T-Bar Row'), ('Smith Machine Bent Over Row', 'Bent Over Row (Smith Machine)'), ('Leverage Shrug', 'Shrug (Machine)'),
    ('Cable Rear Delt Fly', 'Rear Delt Fly (Cable)'), ('Reverse Flyes', 'Rear Delt Fly (Dumbbell)'), ('Front Cable Raise', 'Front Raise (Cable)'),
    ('Smith Machine Overhead Shoulder Press', 'Shoulder Press (Smith Machine)'), ('Decline Dumbbell Bench Press', 'Decline Bench Press (Dumbbell)'),
    ('Incline Cable Flye', 'Incline Cable Fly'), ('Flat Bench Cable Flyes', 'Cable Fly (Flat Bench)'), ('Low Cable Crossover', 'Low Cable Crossover'),
    ('Seated One-arm Cable Pulley Rows', 'Single Arm Cable Row'), ('One Arm Lat Pulldown', 'Single Arm Lat Pulldown (Cable)'), ('Reverse Grip Triceps Pushdown', 'Reverse Grip Triceps Pushdown (Cable)'),
    ('Triceps Pushdown - V-Bar Attachment', 'Triceps Pushdown - V Bar (Cable)'), ('Overhead Cable Curl', 'Overhead Cable Curl'), ('Cable Preacher Curl', 'Preacher Curl (Cable)'),
    ('Sumo Deadlift', 'Sumo Deadlift (Barbell)'), ('Good Morning', 'Good Morning (Barbell)'),
]
EQUIP_LABEL = {'barbell': 'Barbell', 'dumbbell': 'Dumbbell', 'cable': 'Cable', 'machine': 'Machine', 'kettlebells': 'Kettlebell', 'bands': 'Band', 'e-z curl bar': 'EZ Bar'}
PREFIXES = [('Smith Machine ', 'Smith Machine'), ('Smith ', 'Smith Machine'), ('Leverage ', 'Machine'), ('Machine ', 'Machine'), ('Barbell ', 'Barbell'), ('Dumbbell ', 'Dumbbell'),
            ('Cable ', 'Cable'), ('Kettlebell ', 'Kettlebell'), ('EZ-Bar ', 'EZ Bar'), ('EZ Bar ', 'EZ Bar')]
PLURALS = [('Pushups', 'Push Up'), ('Pullups', 'Pull Up'), ('Rows', 'Row'), ('Curls', 'Curl'), ('Raises', 'Raise'), ('Extensions', 'Extension'), ('Flyes', 'Fly'), ('Flye', 'Fly'),
           ('Pulldowns', 'Pulldown'), ('Shrugs', 'Shrug'), ('Squats', 'Squat'), ('Lunges', 'Lunge'), ('Crunches', 'Crunch'), ('Presses', 'Press'), ('Dips', 'Dip'),
           ('Deadlifts', 'Deadlift'), ('Kickbacks', 'Kickback'), ('Twists', 'Twist')]

def standard_name(name, equipment):
    """Database wording -> the usual "Exercise (Equipment)" style: equipment moves to the end, plurals become singular."""
    n, label = name, EQUIP_LABEL.get(equipment)
    for pre, lab in PREFIXES:
        if n.startswith(pre) and len(n) > len(pre) + 3:
            n, label = n[len(pre):], lab
            break
    n = n.replace(' - Medium Grip', '')
    for a, b in PLURALS:
        n = re.sub(r'\b' + a + r'\b', b, n)
    if label and '(' not in n and label.lower() not in n.lower():
        n += ' (' + label + ')'
    return n[0].upper() + n[1:]

def slug(s):
    return re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_')

pop = {old: (i + 1, new) for i, (old, new) in enumerate(POPULAR)}
out = []
for x in src:
    if x.get('category') == 'stretching':
        continue
    rank, nice = pop.get(x['name'], (0, None))
    name = nice or standard_name(x['name'], x.get('equipment') or '')
    aliases = [a.strip() for a in ALIASES.get(x['name'], '').split(',') if a.strip()]
    if name.lower() != x['name'].lower():
        aliases.append(x['name'].lower())
    e = {'id': x['id'], 'n': name, 'p': x['primaryMuscles'], 's': x['secondaryMuscles'],
         'e': x.get('equipment') or 'other', 'c': x.get('category') or 'strength',
         'in': x.get('instructions') or [], 'im': len(x.get('images') or [])}
    if aliases:
        e['a'] = ', '.join(aliases)
    if rank:
        e['pop'] = rank
    out.append(e)
missing_pop = [k for k in pop if k not in {x['name'] for x in src}]
names = {e['n'].lower() for e in out}
for n, p, s, eq in EXTRAS:
    if n.lower() in names:
        continue
    out.append({'id': 'x_' + slug(n), 'n': n, 'p': p, 's': s, 'e': eq, 'c': 'strength', 'in': [], 'im': 0})
missing = [k for k in ALIASES if k not in {x['name'] for x in src}]
out.sort(key=lambda e: e['n'].lower())
json.dump(out, open('data/exercises.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(out), 'exercises;', 'aliases not matched:', missing, '; popular not found:', missing_pop)
dupes = sorted({e['n'] for e in out if sum(1 for f in out if f['n'] == e['n']) > 1})
print('duplicate names:', dupes)
