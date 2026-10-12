# CareerPilot AI — Adaptive Career Intelligence & Recruitment Readiness Platform

**CareerPilot AI** is a recruitment readiness platform designed for students, fresh graduates, and career changers. It unifies the entire career preparation workflow into a continuous improvement loop:

```
Resume Analysis → Explainable Job Matching → Skill-Gap Coaching → Adaptive Mock Interview → Unified Feedback & Tracking
```

---

## 🚀 Key Modules & Architecture

1. **AI Resume Intelligence & ATS Breakdown (`/app/resume`)**
   - Multi-layer structured document parsing (Contact, Education, Skills, Work Experience, Projects, Certifications).
   - ATS Readability Index with dimension scoring: Clarity, Impact, Skills Depth, and Structure.
   - Actionable line-item improvements with original vs. suggested phrasing and recruiter reasoning.
   - User control to **Accept** or **Decline** phrasing suggestions.
   - Zero hallucination policy: Never fabricates phantom metrics or qualifications.

2. **Explainable Resume–Job Matching Engine (`/app/job-matching`)**
   - Transparent, deterministic mathematical scoring formula:
     $$\text{Score} = (\text{Required Skills} \times 55\%) + (\text{Preferred Skills} \times 20\%) + (\text{Experience \& Projects} \times 25\%)$$
   - Dissects target requirements into:
     - **Evidenced Skills**: Explicit proof in resume.
     - **Partially Evidenced Skills**: Adjacent capabilities demonstrated.
     - **Not Evidenced in Resume**: Missing evidence (explicitly labeled as unevidenced, *not* proof the candidate lacks ability).
   - One-click export to the Skill-Gap Coach and Mock Interview Studio.

3. **Personalized Skill-Gap Coach (`/app/skill-gaps`)**
   - Converts unevidenced job skills into actionable, prioritized learning objectives.
   - Real recruiter context ("Why recruiters evaluate this"), candidate baseline evidence, and concrete hands-on micro-projects (no fake course links).
   - Status tracking: *Not Started*, *In Progress*, and *Completed* with real-time roadmap progression.

4. **AI Mock Interview Studio (`/app/interviews`)**
   - Adaptive questioning tailored to the candidate's actual resume projects and target role.
   - Format options: Technical, Behavioral (STAR), HR/Leadership, and Mixed Comprehensive.
   - Difficulty tiers: Entry, Mid, and Senior.
   - Single-question interactive flow with context clue tips.
   - Browser Text-To-Speech (reads interviewer questions aloud) and Speech-To-Text voice dictation.
   - Real-time question evaluation: Score (0-100), What went well, What to improve, Missing points, High-scoring model answer, and STAR analysis.

5. **Unified Readiness Dashboard (`/app/dashboard`)**
   - Candidate Career Readiness Index (0-100) computed from actual persisted records.
   - Recharts visual analytics: Mock interview competency trend across completed sessions.
   - Priority skill gaps, top matched role, and verified recent activity timeline.

---

## 🛠 Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Lucide Icons, Recharts
- **Backend**: Express (port 3000), TypeScript, JWT Session Authentication, PBKDF2 Password Hashing
- **AI Engine**: Google Gemini API (`@google/genai` with `gemini-3.8-flash`) executed strictly server-side
- **Database & Storage**:
  - Resilient persistent store with Row Level Security (RLS) isolation
  - Complete PostgreSQL SQL migration script in `/supabase/migrations/20261012000000_careerpilot_schema.sql` ready for Supabase

---

## ⚙️ Environment Variables

Configure variables in your environment or `.env`:

```env
# Server-side Gemini API key (injected automatically in AI Studio)
GEMINI_API_KEY="your-gemini-api-key"

# Application URL
APP_URL="http://localhost:3000"

# Optional: Supabase configuration if connecting to an external Supabase instance
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Server JWT secret for local session signing
JWT_SECRET="careerpilot-super-secret-jwt-key"
```

---

## 💾 Database & Supabase Setup

The complete PostgreSQL database schema with Row Level Security (RLS) is located at:
`supabase/migrations/20261012000000_careerpilot_schema.sql`

To run in Supabase:
1. Open your Supabase Dashboard -> **SQL Editor**.
2. Paste and run the migration file contents.
3. It creates:
   - Tables: `profiles`, `resumes`, `resume_analyses`, `jobs`, `job_matches`, `skill_goals`, `interview_sessions`, `interview_questions`, `interview_answers`, `interview_feedback`, `activity_events`.
   - Complete RLS policies (`auth.uid() = user_id`) on every table.
   - Private `resumes` storage bucket with path isolation `resumes/[user_id]/*`.

---

## 🧪 Testing

Run the automated test suite verifying deterministic match formulas, normalization, and clamping:

```bash
npx tsx tests/matching.test.ts
```

All 4 unit tests passed:
- Full requirement match gives 100% score
- Partial match respects weights
- Zero evidence properly clamped
- Skill name normalization maps aliases accurately

---

## 📦 Development & Production Commands

```bash
# Install dependencies
npm install

# Start development server (Full-stack Express + Vite on port 3000)
npm run dev

# Run TypeScript check
npm run lint

# Build production assets
npm run build

# Start production server
npm start
```
