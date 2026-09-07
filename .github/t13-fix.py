from pathlib import Path

path = Path("tests/candidate-stale-binding.test.ts")
text = path.read_text(encoding="utf-8")
old = '''  it("passes the submitted reviewed context unchanged into a transactional V4.4 adoption boundary", () => {\n    expect(adoptionRoute).toContain('admin.rpc("adopt_solver_candidate_v44"');\n'''
new = '''  it("passes the submitted reviewed context unchanged into the hardened transactional adoption boundary", () => {\n    expect(adoptionRoute).toContain('admin.rpc("adopt_solver_candidate_v49"');\n'''
if text.count(old) != 1:
    raise SystemExit(f"expected one T08 adoption-boundary assertion, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
