// House polls: the starter content that keeps the public feed from being empty.
// A poll is open for at most a week (MAX_HOURS), so a one-off seed would vanish;
// instead the feed tops itself up. Every house question has one open public poll
// at a time, created by HOUSE_ID; when one closes, the next feed read posts a fresh
// copy. Deadlines are staggered so they don't all expire together. The feed hides
// a house question from anyone who already voted on an earlier copy.
//
// HOUSE_POLLS=off turns this off (the test suite does, so feeds start empty).
import { randomBytes } from 'node:crypto'
import type { Db } from './db'

/** The creator of house polls. Real ids are UUIDs, so this can't collide with an account. */
export const HOUSE_ID = 'house'

/** Votes that close a house poll early and reveal its result. */
export const HOUSE_TARGET = 25

export const HOUSE_POLLS: { question: string; options: string[] }[] = [
  { question: 'Fight one horse-sized duck or 100 duck-sized horses?', options: ['One horse-sized duck', '100 duck-sized horses'] },
  { question: 'Is a hot dog a sandwich?', options: ['Yes, obviously', 'No, obviously', "It's a taco"] },
  { question: 'Pineapple on pizza?', options: ['Delicious', 'A war crime'] },
  { question: 'GIF is pronounced…', options: ['Hard G (gift)', 'Soft G (jif)', 'I just say "the moving picture"'] },
  { question: 'Toilet paper roll: over or under?', options: ['Over', 'Under', 'On the floor like an animal'] },
  { question: 'Cereal first or milk first?', options: ['Cereal first', 'Milk first', 'I eat it dry, fight me'] },
  { question: 'Is water wet?', options: ['Yes', 'No', "I'm going to lie down"] },
  { question: 'Does a straw have one hole or two?', options: ['One', 'Two', 'Zero, it\'s a tube'] },
  { question: 'Is cereal a soup?', options: ['Yes', 'No', "Don't ruin breakfast"] },
  { question: 'Socks with sandals: crime or comfort?', options: ['Crime', 'Comfort'] },
  { question: 'Tabs or spaces?', options: ['Tabs', 'Spaces', "I don't code, why am I here"] },
  { question: 'How many chickens could you take in a fight at once?', options: ['1–10', '11–50', '50+', 'Zero. Chickens are dinosaurs.'] },
  { question: 'Fight a goose or a raccoon?', options: ['Goose', 'Raccoon', "Neither, I'd lose to both"] },
  { question: 'Could you land a plane if both pilots passed out?', options: ['Yes, I\'ve seen movies', 'Absolutely not'] },
  { question: 'Superpower: fly at 2 mph or teleport 10 feet?', options: ['Fly at 2 mph', 'Teleport 10 feet'] },
  { question: 'Always 10 minutes late or always 20 minutes early?', options: ['10 minutes late', '20 minutes early'] },
  { question: 'Spaghetti for hair or sweat maple syrup?', options: ['Spaghetti hair', 'Maple syrup sweat'] },
  { question: 'Crocs: fashion or felony?', options: ['Fashion', 'Felony', 'Sport mode only'] },
  { question: 'Sleeping: blanket on, or one leg out?', options: ['Fully covered', 'One leg out', 'No blanket, chaos'] },
  { question: 'Group chat with 47 unread messages. You…', options: ['Read every one', 'Mark as read', 'Reply "lol" and hope'] },
  { question: 'Which text is ruder?', options: ['"k."', '"ok"', '"👍"'] },
  { question: 'Is the 👍 emoji passive-aggressive?', options: ['Yes, deeply', 'No, it means yes'] },
  { question: 'Pizza crust: eat it or leave it?', options: ['Eat it', 'Leave it', 'Dip it'] },
  { question: 'Breakfast for dinner beats dinner for dinner.', options: ['Agree', 'Disagree'] },
  { question: 'The real main character in your home is…', options: ['Me', 'The cat', 'The dog', 'The Wi-Fi router'] },
  { question: 'Phone at 1% and no charger. You…', options: ['Panic', 'Airplane mode and pray', 'YOLO, keep scrolling'] },
  { question: 'Someone hits reply-all on the company email. They are…', options: ['A hero', 'A villain'] },
  { question: 'Dishwasher: rinse the dishes first?', options: ['Rinse first', "Let the machine do its job"] },
  { question: 'In an elevator, someone is running for it. You…', options: ['Hold the door', 'Mash the close button', 'Pretend to look for the button'] },
  { question: 'Shower: morning or night?', options: ['Morning', 'Night', 'Both, I am a dolphin'] },
  { question: 'Ketchup on scrambled eggs?', options: ['Yes', 'Absolutely not'] },
  { question: 'Who wins: a cat with thumbs or a dog with Wi-Fi?', options: ['Cat with thumbs', 'Dog with Wi-Fi'] },
  { question: 'Greatest human invention?', options: ['The wheel', 'The snooze button', 'Sliced bread', 'The group mute'] },
  { question: 'Gas station sushi: brave or reckless?', options: ['Brave', 'Reckless'] },
  { question: 'Leaving a voicemail in this day and age?', options: ['Polite', 'Psychological warfare'] },
  { question: 'Bagel: cut in half, or sliced like bread?', options: ['Halves', 'Bread slices', 'Who hurt you'] },
  { question: 'Is a Pop-Tart a ravioli?', options: ['Yes', 'No', "Now I can't unsee it"] },
  { question: 'Would you rather talk to animals or speak every human language?', options: ['Talk to animals', 'Every human language'] },
  { question: "It's 2 a.m. and you hear a noise. You…", options: ['Investigate', 'Stay under the blanket', 'Yell "I have a sword"'] },
  { question: 'Mondays are fine, actually.', options: ['Agree', 'Disagree', 'Who let you post this'] },
]

/** Open hours for the i-th house poll: 4 to 7 days, staggered so they don't all expire at once. */
export function houseHours(i: number) {
  return 96 + ((i * 7) % 72)
}

// How often one server instance checks whether the feed needs topping up.
const CHECK_EVERY_MS = 10 * 60 * 1000
// Serialises top-ups when several instances read the feed at once.
const HOUSE_LOCK_KEY = 7_204_313

const holder = globalThis as typeof globalThis & { __tiebreakHouseCheckedAt?: number }

export function houseEnabled() {
  return process.env.HOUSE_POLLS !== 'off'
}

/**
 * Posts a fresh copy of every house question that has no open public poll.
 * Cheap when nothing is missing (one indexed read, at most every 10 minutes per instance).
 * Returns how many were posted.
 */
export async function stockHouse(db: Db, now = new Date(), { force = false } = {}): Promise<number> {
  if (!force) {
    const last = holder.__tiebreakHouseCheckedAt
    if (last !== undefined && now.getTime() - last < CHECK_EVERY_MS) return 0
    holder.__tiebreakHouseCheckedAt = now.getTime()
  }
  const openQuestions = async (sql: Pick<Db, 'query'>) => {
    const { rows } = await sql.query<{ question: string }>(
      `SELECT question FROM polls
        WHERE creator_id = $1 AND visibility = 'public' AND status = 'open' AND closes_at > $2::timestamptz`,
      [HOUSE_ID, now.toISOString()],
    )
    return new Set(rows.map((r) => r.question))
  }
  if ((await openQuestions(db)).size >= HOUSE_POLLS.length) return 0

  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [HOUSE_LOCK_KEY])
    const open = await openQuestions(tx)
    let posted = 0
    for (const [i, poll] of HOUSE_POLLS.entries()) {
      if (open.has(poll.question)) continue
      const closesAt = new Date(now.getTime() + houseHours(i) * 60 * 60 * 1000)
      await tx.query(
        `INSERT INTO polls (id, question, options, target, closes_at, created_at, visibility, creator_id)
         VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz, $6::timestamptz, 'public', $7)`,
        [
          randomBytes(9).toString('base64url'),
          poll.question,
          JSON.stringify(poll.options.map((text) => ({ text, imageUrl: null }))),
          HOUSE_TARGET,
          closesAt.toISOString(),
          now.toISOString(),
          HOUSE_ID,
        ],
      )
      posted++
    }
    return posted
  })
}
