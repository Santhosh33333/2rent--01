/**
 * The experience pillars beyond the original four: sports, activities, travel
 * and AI dating.
 *
 * These are real app surfaces (/sports, /events, /discover, /ai), not filler.
 * Each links to its live route so no button dead-ends. The stages are simple
 * icon chips rather than fake data — these sections explain what each surface
 * does and let the user open it, rather than pretending to show content the
 * public landing cannot render.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Sparkles, Trophy, MapPin } from 'lucide-react';
import { Backdrop } from '../components/Backdrop';

interface ExperienceProps {
  id: string;
  icon: ReactNode;
  title: string;
  sub: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  hand?: string[];
}

function ExperiencePillar({ id, icon, title, sub, body, ctaLabel, ctaHref, hand }: ExperienceProps) {
  return (
    <section className="nb-section nb-pillar" id={id} aria-labelledby={`${id}-h`}>
      <Backdrop scene="events" gradientOnly />
      <div className="nb-veil nb-veil--pillar" />
      <div className="nb-wrap nb-pillar-grid">
        <div className="nb-pillar-info nb-rv">
          <h2 id={`${id}-h`}>{icon}{title}</h2>
          <h3>{sub}</h3>
          <p className="nb-body">{body}</p>
          <Link className="nb-btn nb-btn--purple" to={ctaHref}>{ctaLabel} <span aria-hidden="true">&rarr;</span></Link>
        </div>
        <div className="nb-pillar-stage nb-rv">
          <div className="nb-stage nb-stage--sm" style={{ minHeight: 220 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <div className="prism-chip" style={{ width: 72, height: 72 }}>
                {icon}
              </div>
              <p className="nb-body" style={{ maxWidth: 340, textAlign: 'center' }}>{sub}</p>
            </div>
          </div>
        </div>
      </div>
      {hand ? (
        <p className="nb-hand nb-script" aria-hidden="true">
          {hand.map((line) => <span key={line} style={{ display: 'block' }}>{line}</span>)}
        </p>
      ) : null}
    </section>
  );
}

export function SportsSection() {
  return (
    <ExperiencePillar
      id="sports"
      icon={<Trophy aria-hidden="true" style={{ width: 28, height: 28, color: '#fff' }} />}
      title="Sports"
      sub="Find your team"
      body="Cricket, football, badminton, walking, running. Nabri helps you find people who play what you play, near you, and organise a game without a dozen messages back and forth."
      ctaLabel="Find sports partners"
      ctaHref="/sports"
      hand={['Play together']}
    />
  );
}

export function ActivitiesSection() {
  return (
    <ExperiencePillar
      id="activities"
      icon={<Compass aria-hidden="true" style={{ width: 28, height: 28, color: '#fff' }} />}
      title="Activities"
      sub="Do things together"
      body="Walking, running, cycling, gym, study, photography. An activity on Nabri has a place, a time, people and a chat — so it actually happens instead of dying in a group message."
      ctaLabel="Explore activities"
      ctaHref="/events"
      hand={['Move together']}
    />
  );
}

export function TravelSection() {
  return (
    <ExperiencePillar
      id="travel"
      icon={<MapPin aria-hidden="true" style={{ width: 28, height: 28, color: '#fff' }} />}
      title="Travel"
      sub="Go somewhere, together"
      body="Plan a trip with people who want the same thing. Nabri keeps the itinerary, the checklist and the conversation in one place, so the weekend actually happens."
      ctaLabel="Plan travel"
      ctaHref="/discover"
      hand={['Wander together']}
    />
  );
}

export function AiDatingSection() {
  return (
    <ExperiencePillar
      id="ai-dating"
      icon={<Sparkles aria-hidden="true" style={{ width: 28, height: 28, color: '#fff' }} />}
      title="AI Dating"
      sub="Understand the match"
      body="Nabri AI explains why a recommendation makes sense — shared interests, similar tastes, common communities — and helps you start a real conversation. It never messages anyone for you."
      ctaLabel="Meet the assistant"
      ctaHref="/ai"
      hand={['Real talk, assisted']}
    />
  );
}
