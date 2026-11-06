"""In-memory state behind the read routes, filled by the scheduler and the round driver."""
from .models import Evidence, Job, JobState, Round, Selftest, Workload

# ponytail: in memory, so a restart empties them until they are rebuilt from chain events
WORKLOADS: dict[str, Workload] = {}
SELFTESTS: dict[str, Selftest] = {}
JOBS: dict[int, Job] = {}
SPECS: dict[int, bytes] = {}
STATES: dict[int, JobState] = {}
ROUNDS: dict[int, dict[int, Round]] = {}  # job -> round id on chain (from 1) -> round
EVIDENCE: dict[tuple[int, int], Evidence] = {}
MODELS: dict[int, str] = {}  # job -> latest aggregate hash
CONTROL: dict[int, dict] = {}  # job -> {auto, paused}, read by the round driver
DISPUTES: list[dict] = []  # open {job, round, verifier, operator, segments, deadline}; a verifier reopens after a restart
SEATING: dict[tuple[int, int], set[str]] = {}  # (job, round) -> lowercase operators, set just before openRound
SETTLEMENTS: dict[tuple[int, int], dict] = {}  # (job, round) -> {settlement, sigs: {verifier: signature}}
MISSED: dict[str, int] = {}  # operator -> commits missed in a row
STALLED: dict[int, dict] = {}  # job -> scheduler.diagnose() plus "since", for jobs that can't seat a quorum
REARMED: dict[str, int] = {}  # operator -> unix time of its last re-arm; misses in rounds opened before it don't count
# blob hash -> (job, round) for the evidence and weights of finalized rounds, which anyone may read to audit a payout
PUBLIC: dict[str, tuple[int, int]] = {}
