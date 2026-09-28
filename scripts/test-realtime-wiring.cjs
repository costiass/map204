// Every broadcast event must be both sent and received, on the same channel.
//
// The failure this guards against is unusually quiet. Sending a broadcast to a
// topic nobody is subscribed to succeeds — no error, no warning, the app looks
// entirely healthy — and the messages simply arrive in an empty room. It
// happened here: pointers were published on `page:<pageId>` while the handler
// for them was registered on `document:<docId>`, so every connected person was
// reported as "no pointer sent yet" forever, with nothing in any log.
//
// Two things are checked:
//   1. every event that is sent has a listener, and vice versa
//   2. the channel a send uses and the channel its handler is on are the same
//
// (2) is the one that would have caught it, and it works by reading which
// channel variable each side of an event name refers to.

const fs = require('fs')

const file = 'src/hooks/usePageSync.ts'
const source = fs.readFileSync(file, 'utf8')

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

/* ---- what each channel is, in the source ---- */

// Channels are created as `.channel(\`${DOC_TOPIC}…\`)`, so the topic prefix
// identifies them.
const channelTopics = new Map()
// The variable a created channel is bound to, e.g. `const channel = db` then
// `.channel(`. Both channels use the name `channel`, so they are distinguished
// by the topic they are created with.
const creations = [
  ...source.matchAll(/\.channel\(`\$\{(PAGE|DOC)_TOPIC\}/g),
]
for (const [, which] of creations) {
  channelTopics.set(which === 'DOC' ? 'doc' : 'page', true)
}

if (channelTopics.size === 0) {
  console.log('FAIL  no channels found — this check is not working')
  process.exit(1)
}

/* ---- which channel each send and each handler uses ---- */

/**
 * For each `event: 'name'`, decide whether the site sends or receives it, and
 * which channel it goes through.
 *
 * A send is `something.send({ … event: 'name' … })`; a receive is
 * `.on('broadcast', { event: 'name' }`. The channel is whichever of the known
 * references appears within the surrounding lines.
 */
const events = new Set(
  [...source.matchAll(/event: '([a-z-]+)'/g)]
    .map((m) => m[1])
    // `sync`, `join` and `leave` are presence events, not broadcasts. They are
    // not routed by topic, so counting them here would report failures that do
    // not exist.
    .filter((name) => !['sync', 'join', 'leave'].includes(name)),
)

const lines = source.split('\n')

/**
 * A *send* names its channel by reference: `channelRef.current` is the
 * page-content channel, `channels.get(...)` is the document channel.
 */
function sendChannelNear(from) {
  const slice = lines.slice(Math.max(0, from - 12), from).join('\n')
  const usesMap = /channels\s*\.\s*get\s*\(/.test(slice)
  const usesRef = /channelRef\s*\.\s*current/.test(slice)
  if (usesMap && !usesRef) return 'doc'
  if (usesRef && !usesMap) return 'page'
  return null
}

/**
 * A *handler* belongs to whichever channel is being built around it, so look
 * upwards for the nearest `.channel(\`${…_TOPIC}` — the enclosing block defines
 * the topic, not any variable the handler happens to mention.
 */
function handlerChannelAt(index) {
  for (let i = index; i >= 0; i -= 1) {
    if (/\$\{PAGE_TOPIC\}/.test(lines[i])) return 'page'
    if (/\$\{DOC_TOPIC\}/.test(lines[i])) return 'doc'
  }
  return null
}

for (const event of events) {
  const sends = []
  const receives = []

  lines.forEach((line, index) => {
    if (!line.includes(`event: '${event}'`)) return

    // A `.on(` on the same line, or a few lines above, means this is a handler.
    const window = lines.slice(Math.max(0, index - 2), index + 1).join(' ')
    if (/\.on\s*\(\s*'broadcast'/.test(window)) {
      receives.push({ line: index + 1, channel: handlerChannelAt(index) })
    } else {
      sends.push({ line: index + 1, channel: sendChannelNear(index) })
    }
  })

  if (sends.length === 0) {
    fail(`"${event}" is listened for but never sent`)
    continue
  }
  if (receives.length === 0) {
    fail(`"${event}" is sent but nothing listens for it`)
    continue
  }

  for (const send of sends) {
    const match = receives.find((r) => r.channel === send.channel)
    if (!match) {
      fail(
        `"${event}" is sent on the ${send.channel ?? 'unknown'} channel (line ${send.line}) ` +
          `but listened for on ${receives.map((r) => r.channel ?? 'unknown').join(', ')}. ` +
          `A broadcast sent to a topic nobody is subscribed to succeeds silently.`,
      )
    }
  }
}

if (failures === 0) {
  console.log(
    `realtime: ${events.size} broadcast events, each sent and received on the same channel`,
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
