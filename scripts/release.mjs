import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { appMeta, clean, ghToken, nodeExec, preflight } from 'keel/release'

/*
 * Publish a release: check, clean, build, package, upload.
 *
 * The guards come from `keel/release`, shared with the rest of the suite. This
 * script used to have none of them, and the two it was missing are the two that
 * have actually cost a release:
 *
 *  - **A dirty tree.** Without the check, the published build does not have to
 *    match any commit, and afterwards there is no way to say what shipped.
 *  - **A version that is already released.** electron-builder treats a release
 *    older than two hours as untouchable, skips `latest.yml` with a notice in the
 *    middle of its output, and exits 0 - so the failure is shaped exactly like a
 *    success and the updater keeps offering the old build. Nib lost a whole
 *    release to this on 2026-08-24 before the check existed there either.
 *
 * What stays local is the middle. `out/` and `dist/` MUST both be cleared:
 * electron-builder happily packages whatever is already sitting in `out/`, so
 * skipping the build ships the previous build's code under a new version number.
 * Jot published exactly that on 2026-08-04.
 *
 * The upload has to be electron-builder's own publisher - it names the installer
 * in the dashed form `latest.yml` references, where a hand-made `gh release
 * create` upload gets a name with spaces and electron-updater then 404s on an
 * asset in a release that looks perfectly published. And the token comes from the
 * gh CLI at release time, so no long-lived GH_TOKEN sits in a shell profile.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const exec = nodeExec(root)
const { name, version, tag } = appMeta(root)
console.log(`Releasing ${name} ${version}`)

function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

function run(command, args, env) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: true, env })
}

// Before anything is built, so a refusal costs no time.
const failures = preflight(exec, { tag, checks: ['cleanTree', 'notAlreadyReleased'] })
if (failures.length > 0) {
  fail(failures.map((failure) => failure.message).join('\n\n'))
}

try {
  clean(root, ['out', 'dist'])
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

run('npx', ['electron-vite', 'build'], process.env)

let token
try {
  token = ghToken(exec)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

run('npx', ['electron-builder', '--win', '--publish', 'always'], { ...process.env, GH_TOKEN: token })
console.log('Published. The installed app picks the new version up on its next launch.')
