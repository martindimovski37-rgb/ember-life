"""Build data/exercises.json for the Gym tab.
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

def slug(s):
    return re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_')

out = []
for x in src:
    if x.get('category') == 'stretching':
        continue
    e = {'id': x['id'], 'n': x['name'], 'p': x['primaryMuscles'], 's': x['secondaryMuscles'],
         'e': x.get('equipment') or 'other', 'c': x.get('category') or 'strength',
         'in': x.get('instructions') or [], 'im': len(x.get('images') or [])}
    if x['name'] in ALIASES:
        e['a'] = ALIASES[x['name']]
    out.append(e)
names = {e['n'].lower() for e in out}
for n, p, s, eq in EXTRAS:
    if n.lower() in names:
        continue
    out.append({'id': 'x_' + slug(n), 'n': n, 'p': p, 's': s, 'e': eq, 'c': 'strength', 'in': [], 'im': 0})
missing = [k for k in ALIASES if k not in {e['n'] for e in out}]
out.sort(key=lambda e: e['n'].lower())
json.dump(out, open('data/exercises.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(out), 'exercises;', 'aliases not matched:', missing)
