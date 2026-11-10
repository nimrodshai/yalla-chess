// Lesson summaries from Zoom: every lesson on the calendar with a Zoom link
// is watched once it is over. When Zoom has the meeting's transcript, Claude
// writes the lesson's log from it and the lesson is filled in (see
// applyAiSummary). Internal only: nothing is sent to parents.

import * as store from './business-db.mjs';
import { applyAiSummary, buildOccurrences, getSettings, studentName } from './business.mjs';
import { getClaudeConfig, summarizeTranscript } from './claude.mjs';
import { findLessonTranscript, getZoomConfig, meetingIdFromLink } from './zoom.mjs';
import { addDays, todayInZone } from './time.mjs';
import { logInfo, logWarn } from './log.mjs';

// Zoom keeps a transcript a while after the lesson, and usually has it
// within an hour or two; a lesson still without one after this many days
// is let go.
const LOOKBACK_DAYS = 3;
// Zoom needs a few minutes after the meeting ends to start processing.
const SETTLE_MS = 10 * 60_000;
// A lesson whose transcript is not there yet is looked at again after 15
// minutes, then less and less often, up to every 6 hours.
const FIRST_RETRY_MS = 15 * 60_000;
const MAX_RETRY_MS = 6 * 3_600_000;

const SUMMARY_KINDS = ['group', 'private', 'makeup', 'trial'];

// When each lesson may be looked at again: occurrence key → { attempts, nextAt }.
// In memory only; after a restart every lesson is looked at once more.
const waiting = new Map();

function later(key, now) {
  const attempts = (waiting.get(key)?.attempts || 0) + 1;
  waiting.set(key, { attempts, nextAt: now.getTime() + Math.min(FIRST_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS) });
}

export function forgetWaiting() {
  waiting.clear();
}

// The lessons over and still without a summary from Zoom.
function lessonsToSummarize(groups, now, settings) {
  const today = todayInZone(settings.businessTimezone, now);
  return buildOccurrences(groups, addDays(today, -LOOKBACK_DAYS), today, settings).filter((occurrence) => {
    if (!SUMMARY_KINDS.includes(occurrence.kind) || !occurrence.studentIds.length) return false;
    if (Date.parse(occurrence.endAt) + SETTLE_MS > now.getTime()) return false;
    if (!meetingIdFromLink(occurrence.zoomLink)) return false;
    if (occurrence.loggedLessonId) {
      const lesson = store.lessons.get(occurrence.loggedLessonId);
      if (!lesson || lesson.status !== 'held' || lesson.aiSummaryAt) return false;
    }
    return (waiting.get(occurrence.key)?.nextAt || 0) <= now.getTime();
  });
}

// What Claude is told about the lesson besides the transcript, and the
// language the log is written in: the group's, or the student's.
function lessonDetails(occurrence) {
  const students = occurrence.studentIds.map((id) => store.students.get(id)).filter(Boolean);
  const profile = occurrence.groupId ? store.groupProfiles.get(occurrence.groupId) : null;
  const language = profile?.language || students[0]?.language || 'he';
  const details = [
    `Lesson: ${occurrence.title}${occurrence.groupId ? ' (group)' : ` (${occurrence.kind})`}`,
    `Date: ${occurrence.date} at ${occurrence.startTime}, ${occurrence.durationMinutes || 60} minutes`,
    occurrence.teacher ? `Teacher: ${occurrence.teacher}` : '',
    `Students: ${students.map((student) => `${studentName(student)}${student.level ? ` (${student.level})` : ''}`).join(', ') || occurrence.students.join(', ')}`
  ].filter(Boolean).join('\n');
  return { details, language: language === 'en' ? 'en' : 'he' };
}

// Looks at every lesson due and fills in those Zoom has a transcript for.
// The calls to Zoom and Claude run outside the write lock (a summary takes
// a while); `write` runs the change under it.
export async function runLessonSummaries({ groups, write, now = new Date(), settings = getSettings(), zoom = getZoomConfig(), claude = getClaudeConfig() }) {
  const result = { checked: 0, filled: 0, waiting: 0, skipped: 0, failed: 0 };
  if (!zoom.ready || !claude.ready) return result;

  for (const occurrence of lessonsToSummarize(groups, now, settings)) {
    result.checked += 1;
    try {
      const transcript = await findLessonTranscript({ meetingId: meetingIdFromLink(occurrence.zoomLink), startAt: occurrence.startAt, endAt: occurrence.endAt }, zoom);
      if (!transcript) {
        later(occurrence.key, now);
        result.waiting += 1;
        continue;
      }
      const { details, language } = lessonDetails(occurrence);
      const summary = await summarizeTranscript({ transcript: transcript.text, details, language }, claude);
      waiting.delete(occurrence.key);
      if (!summary.isLesson) {
        // Not a lesson (an empty or test meeting); not looked at again
        // until a restart.
        waiting.set(occurrence.key, { attempts: 0, nextAt: Infinity });
        result.skipped += 1;
        logInfo('lesson_summaries.not_a_lesson', { lesson: occurrence.key });
        continue;
      }
      const lesson = await write(() => {
        // The calendar as it is now: someone may have logged the lesson
        // while Claude was writing.
        const current = buildOccurrences(groups, occurrence.date, occurrence.date, settings).find((entry) => entry.key === occurrence.key);
        return current ? applyAiSummary(current, summary, { meetingUuid: transcript.meetingUuid }) : null;
      });
      if (lesson) {
        result.filled += 1;
        logInfo('lesson_summaries.filled', { lesson: occurrence.key, id: lesson.id });
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      later(occurrence.key, now);
      result.failed += 1;
      logWarn('lesson_summaries.failed', { lesson: occurrence.key, detail: error.message });
    }
  }

  if (result.filled || result.failed) logInfo('lesson_summaries.run', result);
  return result;
}
