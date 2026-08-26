export const SITE_NAME = "Roseville Couples Counseling";
export const PRACTITIONER = "James Christensen LMFT";
export const LICENSE = "LMFT #142990";
export const PHONE_DISPLAY = "916-292-8920";
export const PHONE_TEL = "tel:9162928920";
export const EMAIL_DISPLAY = "james@jamesmchristensen.com";
export const BOOKING_URL = "https://james.clientsecure.me/request/service";
export const ADDRESS = {
  street: "300 Harding Blvd, Suite 108",
  city: "Roseville",
  region: "CA",
  postal: "95678",
};

export const DEFAULT_DESCRIPTION =
  "Couples therapy and marriage counseling in Roseville, CA for conflict, disconnection, infidelity, and communication problems. First session free.";

export type NavLink = { href: string; label: string };
export type NavFolder = { label: string; id: string; items: NavLink[] };
export type NavItem = NavLink | NavFolder;

export const servicesNav: NavLink[] = [
  { href: "/intensive-couples-therapy", label: "Intensive Couples Therapy" },
  { href: "/private-couples-retreats", label: "Private Marriage Retreats" },
  { href: "/codependency", label: "Codependency" },
  { href: "/communication", label: "Communication" },
  { href: "/disconnection", label: "Disconnection" },
  { href: "/infidelity", label: "Infidelity" },
  { href: "/intimacy-and-desire", label: "Dead Bedroom" },
  { href: "/narcissism", label: "Narcissism" },
  { href: "/relationship-anxiety", label: "Relationship Anxiety" },
  { href: "/threats-of-divorce", label: "Threats of Divorce" },
];

export const resourcesNav: NavLink[] = [
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
  { href: "/podcast", label: "Podcast" },
  { href: "/videos", label: "Videos" },
  { href: "/contact", label: "Contact" },
  { href: "/read", label: "Reading List" },
  { href: "/book-summaries", label: "Book Summaries" },
  { href: "/crucible", label: "About Crucible Therapy" },
  { href: "/about-james-christensen", label: "About James Christensen" },
  { href: "/david-schnarch", label: "About David Schnarch" },
  { href: "/how-couples-therapy-works", label: "How Couples Therapy Works" },
];

export const primaryNav: NavItem[] = [
  { href: "/", label: "Home" },
  { label: "Services", id: "services", items: servicesNav },
  { label: "Resources", id: "resources", items: resourcesNav },
];

export const topicCards = [
  {
    href: "/communication",
    title: "Communication & Conflict",
    body: "Every conversation turns into a battle. You're not fighting about money or the kids—you're fighting because something deeper is broken underneath.",
  },
  {
    href: "/intimacy-and-desire",
    title: "Sex & Intimacy",
    body: "One of you wants more. The other feels pressured, guilty, or just numb. This isn't just a libido problem — it's a reflection of what's happening between you emotionally, and it won't be fixed by scheduling date nights or trying harder.",
  },
  {
    href: "/relationship-anxiety",
    title: "Relationship Anxiety",
    body: "Your worry about the relationship has become the relationship. You're scanning for signs, replaying conversations, seeking reassurance that never holds. The anxiety isn't just in your head — it's running through your entire couple system, and it takes a different kind of work to quiet it.",
  },
  {
    href: "/threats-of-divorce",
    title: "Threats of Divorce",
    body: "Every fight ends the same way: someone says \"maybe we should just get divorced.\" It's not a real decision — it's a weapon, or a panic button, or the only way one of you knows how to say \"I'm drowning right now.\"",
  },
  {
    href: "/disconnection",
    title: "Roommate Syndrome",
    body: "You live in the same house, sleep in the same bed, and feel completely alone. You're not in crisis — you're not even fighting. You're just... nothing.",
  },
  {
    href: "/infidelity",
    title: "Infidelity & Trust",
    body: "Whether you discovered the affair or confessed it, you're cycling between rage, grief, and numbness—wondering if your marriage can survive this.",
  },
  {
    href: "/narcissism",
    title: "Narcissism",
    body: "You're never good enough. You've learned to monitor your tone, your words, even your facial expressions — because anything can be interpreted as criticism. The reality is more nuanced and more hopeful than the internet has led you to believe.",
  },
  {
    href: "/codependency",
    title: "Codependency",
    body: "You've lost track of where you end and your partner begins. Their mood is your mood. Their crisis is your crisis. What looks like love and devotion is actually something else — and understanding the difference is where real change starts.",
  },
];

export const ourStory = [
  {
    lead: "Molly and I got married",
    rest: "before I started pilot training in 2001. Military life was hard on our marriage, and we soon started to drift apart.",
  },
  {
    lead: "We wanted to provide a loving home",
    rest: "for our children, but we didn't know how. All we felt was anger, resentment, and hurt feelings.",
  },
  {
    lead: "We finally started therapy",
    rest: "after my first deployment, but it didn't help much. We worked with five therapists over five years, but nothing changed.",
  },
  {
    lead: "Our sixth therapist saved our marriage.",
    rest: "Five sessions with her changed our marriage more than five years with our other therapists.",
  },
  {
    lead: "Our new therapist used an approach called Crucible Therapy.",
    rest: "She was blunt and direct, and she helped us deal with the real problems in our marriage.",
  },
  {
    lead: "I decided to become a Crucible Therapist",
    rest: "to help couples the way our therapist helped us.",
  },
];

export const differentKind = [
  {
    lead: "Molly and I have been married",
    rest: "for 25 years. We've raised four children, survived infidelity, and have grown to love and appreciate each other more than we ever thought was possible.",
  },
  {
    lead: "I do strength-based therapy.",
    rest: "I won't validate your victimhood, but I will help you feel more powerful in your relationship.",
  },
  {
    lead: "I'm blunt and direct.",
    rest: "You'll never wonder what I really think.",
  },
  {
    lead: "I've worked with over 400 couples.",
    rest: "It takes more than a license and a degree to become a good couples therapist.",
  },
  {
    lead: "I have years of experience",
    rest: "and hundreds of hours of post-graduate training.",
  },
  {
    lead: "I offer two-hour and three-hour",
    rest: "intensive sessions.",
  },
  {
    lead: "If you don't live in California,",
    rest: "I offer online relationship coaching to clients all over the world.",
  },
  {
    lead: "Most couples see meaningful progress",
    rest: "after 5-10 sessions. Complex cases take longer.",
  },
];

export const offer = {
  headline: "Your First Session is Free",
  lines: ["Additional sessions cost $300.", "I don't take insurance."],
  cta: "Click Here to Schedule",
};

export function isFolder(item: NavItem): item is NavFolder {
  return "items" in item;
}

export function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
