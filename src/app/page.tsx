import Image from 'next/image';
import { LandingAuthNav } from '@/components/LandingAuthNav';
import { ThemeToggle } from '@/components/Effects';
import { SiteFooter } from '@/components/SiteFooter';
import { Styles } from '@/components/Styles';
import { createSessionClient, getSessionUser } from '@/lib/supabase/server';

const TEAM = [
  {
    name: 'Marwen Agrebi',
    initials: 'MA',
    role: 'IEEE CS INSAT Chair',
    photo: '/assets/images/team/chair_cs.jpg',
    alt: 'Marwen Agrebi — IEEE CS INSAT Chair',
    linkedin: 'https://www.linkedin.com/in/marwen-agrebi-207524417/',
    email: 'marwen.agrebi@insat.ucar.tn',
  },
  {
    name: 'Kmar Ben Ayed',
    initials: 'KBA',
    role: 'IEEE CS VCTA',
    photo: '/assets/images/team/vcta.jpg',
    alt: 'Kmar Ben Ayed — VCTA',
    linkedin: 'https://www.linkedin.com/in/kmar-b-b2026621a/',
    email: 'kamar.benayed@insat.ucar.tn',
  },
  {
    name: 'Seddik Belaam',
    initials: 'SB',
    role: 'Platform Manager',
    photo: '/assets/images/team/webmaster.jpg',
    alt: 'Seddik Belaam — Platform Manager',
    linkedin: 'https://www.linkedin.com/',
    email: 'mohamedseddik.belaam@insat.ucar.tn',
  },
] as const;

export default async function LandingPage() {
  // Resolved on the server, so the navbar renders in its final state with no
  // "Sign Up" -> username flicker after load.
  const user = await getSessionUser();
  let profile: { username: string; total_points: number | null } | null = null;
  if (user) {
    const supabase = await createSessionClient();
    const { data } = await supabase
      .from('profiles')
      .select('username, total_points')
      .eq('id', user.id)
      .maybeSingle();
    profile = data ?? { username: 'User', total_points: 0 };
  }

  return (
    <>
      <Styles />

      <header className="navbar">
        <div className="logo">
          <span className="logo-cube">◈</span>
          The Time Portal <span className="badge">IEEE CS INSAT SBC</span>
        </div>
        <nav className="nav-links">
          <a href="/dashboard/challenges">Challenges</a>
          <ThemeToggle />
          {profile ? (
            <LandingAuthNav username={profile.username} points={profile.total_points ?? 0} />
          ) : (
            <a href="/account/signup" className="cta-btn" id="auth-btn">Sign Up</a>
          )}
        </nav>
      </header>

      <main className="hero">
        <div className="tagline">✦ IEEE CS INSAT SBC</div>
        <h1>The <span className="grad">Time Portal</span></h1>
        <p className="subtitle">Solve monthly coding challenges, dive into hands-on coding problems.</p>

        <div className="hero-buttons">
          {profile ? (
            <a href="/dashboard/dashboard" className="btn btn-primary" id="time-rift-btn">Open Dashboard</a>
          ) : (
            <a href="/account/login" className="btn btn-primary" id="time-rift-btn">Log In</a>
          )}
          <span className="space"></span>
          <a href="#team" className="btn btn-secondary">Meet the Team</a>
        </div>
      </main>

      <section className="team-section" id="team">
        <div className="team-header">
          <span className="section-badge">Behind the Scenes</span>
          <h2>The Team Behind This Work</h2>
          <p className="section-subtitle">Built and maintained by the IEEE CS INSAT Student Branch Chapter.</p>
        </div>

        <div className="team-grid">
          {TEAM.map((member) => (
            <div className="card team-card" key={member.name}>
              <div className="team-avatar">
                <span className="team-avatar-initials">{member.initials}</span>
                {/* Resized and re-encoded on demand (the chair photo alone was 1.8 MB). */}
                <Image src={member.photo} alt={member.alt} width={240} height={240} sizes="120px" />
              </div>
              <h3>{member.name}</h3>
              <p className="team-role">{member.role}</p>
              <div className="team-links">
                <a href={member.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>
                <a href={`mailto:${member.email}`}>Email</a>
              </div>
            </div>
          ))}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
