import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db.js';
import * as gemini from './server/gemini.js';
import { supabaseService } from './server/supabase.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'careerpilot-dev-jwt-secret-key-998877';

// Middleware
app.use(express.json({ limit: '15mb' }));

// Ensure upload storage directory exists
const STORAGE_DIR = path.resolve(process.cwd(), 'data', 'storage', 'resumes');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Authentication Middleware
interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string };
}

const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization token.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string };
    const user = db.getUserById(decoded.id);
    if (!user) {
      res.status(401).json({ error: 'User session expired or user not found.' });
      return;
    }
    req.user = { id: user.id, email: user.email };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session token.' });
    return;
  }
};

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

app.post('/api/auth/register', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }

    const existing = db.getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const { user, profile } = db.createUser(email, password);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user.id, email: user.email }, profile });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to complete registration.' });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = db.getUserByEmail(email);
    if (!user || !db.verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const profile = db.getProfile(user.id);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email }, profile });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to process login.' });
  }
});

// Demo login option (creates or returns pre-seeded demo account for rapid evaluation)
app.post('/api/auth/demo', async (req: Request, res: Response) => {
  try {
    const demoEmail = 'demo.candidate@careerpilot.ai';
    let user = db.getUserByEmail(demoEmail);

    if (!user) {
      const created = db.createUser(demoEmail, 'CareerPilot2026!');
      user = created.user;

      // Seed initial candidate data for the demo user
      db.updateProfile(user.id, {
        full_name: 'Alex Rivera',
        education_level: 'B.S. in Computer Science, State University (2024)',
        current_role: 'Associate Software Engineer',
        experience_level: 'entry',
        target_roles: ['Full Stack Engineer', 'Backend Software Engineer', 'AI Application Developer'],
        preferred_skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Python', 'Docker'],
        career_goals: 'Accelerate readiness for Mid-Level Software Engineer positions at modern product companies.',
        onboarding_completed: true,
        readiness_score: 68,
      });

      // Seed a sample resume
      const sampleResumeText = `
Alex Rivera
Email: alex.rivera@example.com | Phone: (555) 234-5678 | Location: San Francisco, CA
LinkedIn: linkedin.com/in/alex-rivera-dev | GitHub: github.com/alexrivera

PROFESSIONAL SUMMARY
Results-driven software engineer with 1.5 years of experience building responsive full-stack applications with React, TypeScript, Node.js, and PostgreSQL. Passionate about clean architecture, test-driven development, and cloud deployments.

WORK EXPERIENCE
Associate Software Engineer | CloudVibe Systems | June 2024 - Present
• Designed and shipped RESTful API microservices in Node.js and TypeScript serving 40,000 daily requests.
• Refactored customer onboarding flow using React and Tailwind CSS, increasing sign-up completion rate by 18%.
• Collaborated in bi-weekly Agile sprints, writing Jest unit tests with 84% code coverage across core payment modules.
• Worked with PostgreSQL database schema migrations and query optimizations to reduce response time.

Software Engineering Intern | NextGen Labs | May 2023 - August 2023
• Built an internal reporting dashboard in React and Express to monitor server telemetry and error logs.
• Integrated Docker container workflows into local development setup for team members.

TECHNICAL SKILLS
Languages: TypeScript, JavaScript, Python, SQL, HTML5, CSS3
Frameworks & Libraries: React, Node.js, Express, Tailwind CSS, Jest
Databases & Cloud: PostgreSQL, SQLite, Redis, Docker, Git, Linux
Core Competencies: REST APIs, System Design fundamentals, Agile/Scrum, CI/CD

EDUCATION
B.S. in Computer Science | State University, GPA: 3.8/4.0 | Graduated May 2024

PROJECTS
• DevPulse Analytics: Real-time telemetry dashboard using React, WebSocket, and Express.
• TaskMaster Pro: Full-stack task management application with role-based access control and PostgreSQL.
      `.trim();

      const resume = db.createResume(user.id, {
        file_name: 'Alex_Rivera_Software_Engineer_Resume.pdf',
        file_size: 48200,
        storage_path: `demo_${user.id}_resume.pdf`,
        mime_type: 'application/pdf',
        raw_text: sampleResumeText,
      });

      // Save initial sample analysis
      db.saveResumeAnalysis(user.id, {
        resume_id: resume.id,
        parsed_profile: {
          contact: { name: 'Alex Rivera', email: 'alex.rivera@example.com', location: 'San Francisco, CA' },
          summary: 'Results-driven software engineer with 1.5 years of experience building responsive full-stack applications.',
          education: [{ institution: 'State University', degree: 'B.S.', field: 'Computer Science', graduationYear: '2024', gpa: '3.8/4.0' }],
          skills: {
            technical: ['TypeScript', 'JavaScript', 'Python', 'SQL'],
            frameworks: ['React', 'Node.js', 'Express', 'Tailwind CSS', 'Jest'],
            tools: ['Git', 'Docker', 'PostgreSQL', 'Linux'],
            soft: ['Agile/Scrum', 'Collaboration', 'Problem Solving'],
          },
          work_experience: [
            {
              title: 'Associate Software Engineer',
              company: 'CloudVibe Systems',
              duration: 'June 2024 - Present',
              bulletPoints: [
                'Designed and shipped RESTful API microservices in Node.js and TypeScript serving 40,000 daily requests.',
                'Refactored customer onboarding flow using React and Tailwind CSS, increasing sign-up completion rate by 18%.',
                'Collaborated in bi-weekly Agile sprints, writing Jest unit tests with 84% code coverage.',
              ],
            },
          ],
          projects: [
            { name: 'DevPulse Analytics', description: 'Real-time telemetry dashboard using React and WebSocket', technologies: ['React', 'WebSocket', 'Express'] },
          ],
          certifications: ['AWS Certified Cloud Practitioner (In-Progress)'],
          achievements: ['Dean’s Honor List 2022-2024'],
        },
        strengths: [
          'Strong full-stack stack alignment with TypeScript, React, and Node.js microservices.',
          'Quantified impact demonstrated in onboarding flow optimization (18% boost) and request volume.',
          'Solid engineering fundamentals including Jest unit testing and Docker containerization.',
        ],
        weaknesses: [
          'Could highlight more distributed systems experience or asynchronous message queues.',
          'Project descriptions can detail system scaling constraints and load testing.',
        ],
        suggestions: [
          {
            id: 'sug-1',
            section: 'Work Experience',
            original: 'Worked with PostgreSQL database schema migrations and query optimizations to reduce response time.',
            suggested: 'Optimized PostgreSQL queries and normalized schema structures, lowering database latency by 25% across high-traffic endpoints.',
            reason: 'Replaces passive wording with active technical impact and specific optimization metrics.',
            status: 'pending',
          },
          {
            id: 'sug-2',
            section: 'Projects',
            original: 'TaskMaster Pro: Full-stack task management application with role-based access control and PostgreSQL.',
            suggested: 'Architected TaskMaster Pro: Production-grade productivity platform featuring granular RBAC, JWT session security, and relational data modeling.',
            reason: 'Explicitly spotlights security architectures and system robustness.',
            status: 'pending',
          },
        ],
        quantified_improvements: [
          {
            original: 'Built an internal reporting dashboard in React and Express',
            improved: 'Delivered reporting dashboard in React/Express adopted by 15+ internal engineers for daily server telemetry',
            metricType: 'Adoption / User Reach',
          },
        ],
        score_breakdown: { clarity: 90, impact: 82, skillsDepth: 85, structure: 88 },
        ats_score: 86,
      });

      // Seed a sample job posting
      const sampleJob = db.createJob(user.id, {
        title: 'Full Stack Engineer (TypeScript & Cloud)',
        company: 'Veloce Data Labs',
        description: `
We are seeking an energetic Full Stack Engineer to build next-generation data applications.
Responsibilities:
- Build modular React interfaces and robust Node.js / TypeScript microservices.
- Design performant PostgreSQL schemas and implement caching strategies.
- Maintain CI/CD pipelines, containerize services using Docker, and contribute to code reviews.
Requirements:
- 1-3 years of full-stack engineering experience.
- Strong proficiency in TypeScript, React, Node.js, and SQL/PostgreSQL.
- Familiarity with Docker and Git workflows.
- Nice to have: GraphQL, Redis, AWS services.
        `.trim(),
        parsed_requirements: {
          required_skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'Git'],
          preferred_skills: ['GraphQL', 'Redis', 'AWS', 'CI/CD'],
          experience_years: '1-3 years',
          education_level: 'B.S. in Computer Science or equivalent experience',
          responsibilities: [
            'Build modular React interfaces and robust Node.js microservices',
            'Design performant PostgreSQL schemas',
            'Maintain CI/CD pipelines and Docker containerization',
          ],
          competencies: ['System Design', 'Code Reviews', 'Collaborative Problem Solving'],
        },
      });

      // Seed a match
      db.saveJobMatch(user.id, {
        resume_id: resume.id,
        job_id: sampleJob.id,
        match_score: 82,
        evidenced_skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'Git'],
        missing_skills: ['GraphQL', 'Redis'],
        partial_skills: ['AWS (AWS Cloud Practitioner noted in progress)', 'CI/CD'],
        experience_alignment: 'Strong direct match with 1.5 years experience in React/Node/PostgreSQL and unit testing.',
        scoring_breakdown: {
          required_skills_score: 100,
          preferred_skills_score: 50,
          experience_score: 85,
          formula_explanation: 'Formula: (Required Skills × 55%) + (Preferred Skills × 20%) + (Experience & Project Alignment × 25%).',
        },
        recommended_improvements: [
          'Add a sample or personal project demonstrating Redis caching or GraphQL querying.',
          'Specify CI/CD pipeline automation tools used in previous deployments.',
        ],
      });

      // Seed skill goals
      db.createSkillGoal(user.id, {
        job_id: sampleJob.id,
        skill_name: 'Redis In-Memory Caching',
        priority: 'high',
        why_matters: 'Essential for high-throughput microservices and reducing PostgreSQL read load.',
        candidate_evidence: 'Solid understanding of backend request life cycles and relational databases.',
        learning_objective: 'Implement Redis cache-aside pattern with TTL invalidation on REST endpoints.',
        recommended_exercise: 'Build a Node.js caching middleware using ioredis for frequent database queries.',
        status: 'in_progress',
        sort_order: 1,
      });

      db.createSkillGoal(user.id, {
        job_id: sampleJob.id,
        skill_name: 'GraphQL API Design',
        priority: 'medium',
        why_matters: 'Enables flexible data fetching and minimizes network over-fetching in complex UI views.',
        candidate_evidence: 'Deep proficiency in RESTful design and TypeScript typing.',
        learning_objective: 'Create a GraphQL schema with Apollo Server and TypeScript resolvers.',
        recommended_exercise: 'Expose a GraphQL endpoint querying existing PostgreSQL tables with field-level resolvers.',
        status: 'not_started',
        sort_order: 2,
      });

      // Seed a completed interview session
      const interviewSession = db.createInterviewSession(user.id, {
        resume_id: resume.id,
        job_id: sampleJob.id,
        target_role: 'Full Stack Engineer',
        interview_type: 'technical',
        difficulty: 'mid',
        total_questions: 3,
      });

      const q1 = db.addInterviewQuestion(user.id, interviewSession.id, {
        question_number: 1,
        question_text: 'In your resume, you mentioned optimizing PostgreSQL queries at CloudVibe Systems. How did you identify the slow queries, and what indexing or query structure changes did you make?',
        question_type: 'technical',
        target_competency: 'Database Optimization & Diagnostics',
        context_clue: 'Focus on query profiling (EXPLAIN ANALYZE) and index strategies.',
      });

      db.submitInterviewAnswer(
        user.id,
        interviewSession.id,
        q1.id,
        'We monitored slow endpoints in our logs and used EXPLAIN ANALYZE on our PostgreSQL queries. We identified sequential scans on our payments table where a composite index on user_id and created_at was missing. After adding the B-tree index and rewriting a subquery into a JOIN, query latency dropped significantly.',
        {
          score: 88,
          what_went_well: 'Demonstrated precise knowledge of EXPLAIN ANALYZE, composite B-tree indexing, and converting subqueries to JOINs.',
          what_to_improve: 'Could mention monitoring index write overhead or query planning cache implications.',
          missing_points: ['Index maintenance costs and connection pooling considerations'],
          suggested_approach: 'Excellent answer. Highlighting connection pooling or pg_stat_statements adds senior-level depth.',
          follow_up_tip: 'Ready to tackle deeper concurrency questions.',
        }
      );

      db.completeInterviewSession(
        interviewSession.id,
        user.id,
        'Strong technical communication with practical system debugging experience.',
        ['Clear explanation of database diagnostics and indexing', 'Structured answers'],
        ['Expand on distributed state handling and asynchronous task queues']
      );
    }

    const profile = db.getProfile(user.id);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email }, profile, isDemo: true });
  } catch (err: any) {
    console.error('Demo login error:', err);
    res.status(500).json({ error: 'Failed to initialize demo session.' });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const profile = db.getProfile(req.user!.id);
  res.json({ user: req.user, profile });
});

app.put('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = db.updateProfile(req.user!.id, req.body);
    db.logActivity(req.user!.id, 'profile_updated', 'Updated career preferences and profile details');
    res.json({ profile: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ==========================================
// RESUME INTELLIGENCE ROUTES
// ==========================================

app.get('/api/resumes', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const resumes = db.getResumes(req.user!.id);
  res.json({ resumes });
});

app.get('/api/resumes/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const resume = db.getResume(req.params.id, req.user!.id);
  if (!resume) {
    res.status(404).json({ error: 'Resume not found.' });
    return;
  }
  const analysis = db.getResumeAnalysis(resume.id, req.user!.id);
  res.json({ resume, analysis });
});

app.post('/api/resumes/upload', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileName, fileSize, mimeType, rawText, base64Data } = req.body;
    if (!fileName || (!rawText && !base64Data)) {
      res.status(400).json({ error: 'Resume file name and content are required.' });
      return;
    }

    let textContent = rawText || '';

    // If PDF base64 provided and text is minimal, write to private storage
    const storagePath = path.join(STORAGE_DIR, `${req.user!.id}_${Date.now()}_${path.basename(fileName)}`);
    if (base64Data) {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(storagePath, buffer);
      if (!textContent) {
        // Simple text extraction from buffer if plain text or fallback
        textContent = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
      }
    }

    if (!textContent || textContent.trim().length < 50) {
      res.status(400).json({ error: 'Could not extract readable text from the document. Please ensure the PDF contains selectable text or paste the resume text.' });
      return;
    }

    // Create Resume Record
    const resume = db.createResume(req.user!.id, {
      file_name: fileName,
      file_size: fileSize || textContent.length,
      storage_path: storagePath,
      mime_type: mimeType || 'application/pdf',
      raw_text: textContent,
    });

    // Run AI Parsing & Intelligence in parallel
    const userProfile = db.getProfile(req.user!.id);
    const targetRole = userProfile?.target_roles?.[0] || 'Software Engineer';

    const [parsedProfile, analysisData] = await Promise.all([
      gemini.parseResumeText(textContent),
      gemini.analyzeResumeIntelligence(textContent, targetRole),
    ]);

    const analysis = db.saveResumeAnalysis(req.user!.id, {
      resume_id: resume.id,
      parsed_profile: parsedProfile,
      strengths: analysisData.strengths || [],
      weaknesses: analysisData.weaknesses || [],
      suggestions: analysisData.suggestions || [],
      quantified_improvements: analysisData.quantified_improvements || [],
      score_breakdown: analysisData.score_breakdown || { clarity: 80, impact: 75, skillsDepth: 80, structure: 85 },
      ats_score: analysisData.ats_score || 80,
    });

    res.status(201).json({ resume, analysis });
  } catch (err: any) {
    console.error('Resume upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to process and analyze resume.' });
  }
});

app.post('/api/resumes/:id/analyze', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const resume = db.getResume(req.params.id, req.user!.id);
    if (!resume) {
      res.status(404).json({ error: 'Resume not found.' });
      return;
    }

    const { targetRole } = req.body;
    const [parsedProfile, analysisData] = await Promise.all([
      gemini.parseResumeText(resume.raw_text),
      gemini.analyzeResumeIntelligence(resume.raw_text, targetRole || 'Software Engineer'),
    ]);

    const analysis = db.saveResumeAnalysis(req.user!.id, {
      resume_id: resume.id,
      parsed_profile: parsedProfile,
      strengths: analysisData.strengths || [],
      weaknesses: analysisData.weaknesses || [],
      suggestions: analysisData.suggestions || [],
      quantified_improvements: analysisData.quantified_improvements || [],
      score_breakdown: analysisData.score_breakdown || { clarity: 80, impact: 75, skillsDepth: 80, structure: 85 },
      ats_score: analysisData.ats_score || 80,
    });

    res.json({ analysis });
  } catch (err: any) {
    console.error('Re-analyze error:', err);
    res.status(500).json({ error: 'Failed to re-analyze resume.' });
  }
});

app.patch('/api/resumes/:resumeId/suggestions/:suggestionId', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) {
    res.status(400).json({ error: 'Status must be accepted or rejected.' });
    return;
  }

  const analysis = db.getResumeAnalysis(req.params.resumeId, req.user!.id);
  if (!analysis) {
    res.status(404).json({ error: 'Resume analysis not found.' });
    return;
  }

  const ok = db.updateSuggestionStatus(analysis.id, req.user!.id, req.params.suggestionId, status);
  if (!ok) {
    res.status(404).json({ error: 'Suggestion not found.' });
    return;
  }

  res.json({ success: true, status });
});

app.delete('/api/resumes/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const deleted = db.deleteResume(req.params.id, req.user!.id);
  if (!deleted) {
    res.status(404).json({ error: 'Resume not found or already deleted.' });
    return;
  }
  res.json({ success: true });
});

// ==========================================
// JOB MATCHING ROUTES
// ==========================================

app.get('/api/jobs', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const jobs = db.getJobs(req.user!.id);
  res.json({ jobs });
});

app.post('/api/jobs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, company, description } = req.body;
    if (!title || !description) {
      res.status(400).json({ error: 'Job title and description are required.' });
      return;
    }

    const parsedRequirements = await gemini.extractJobRequirements(title, description);

    const job = db.createJob(req.user!.id, {
      title,
      company: company || 'Confidential Employer',
      description,
      parsed_requirements: parsedRequirements,
    });

    res.status(201).json({ job });
  } catch (err: any) {
    console.error('Job creation error:', err);
    res.status(500).json({ error: 'Failed to extract requirements and save job.' });
  }
});

app.delete('/api/jobs/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const ok = db.deleteJob(req.params.id, req.user!.id);
  if (!ok) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  res.json({ success: true });
});

app.get('/api/matches', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const matches = db.getJobMatches(req.user!.id);
  res.json({ matches });
});

app.get('/api/matches/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const match = db.getJobMatch(req.params.id, req.user!.id);
  if (!match) {
    res.status(404).json({ error: 'Match analysis not found.' });
    return;
  }
  res.json({ match });
});

app.post('/api/matches', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { resumeId, jobId } = req.body;
    if (!resumeId || !jobId) {
      res.status(400).json({ error: 'Resume ID and Job ID are required.' });
      return;
    }

    const resume = db.getResume(resumeId, req.user!.id);
    const job = db.getJob(jobId, req.user!.id);
    if (!resume || !job) {
      res.status(404).json({ error: 'Resume or Job not found.' });
      return;
    }

    const analysis = db.getResumeAnalysis(resume.id, req.user!.id);
    const matchResult = await gemini.matchResumeToJob(
      resume.raw_text,
      analysis?.parsed_profile,
      job.title,
      job.parsed_requirements
    );

    const savedMatch = db.saveJobMatch(req.user!.id, {
      resume_id: resume.id,
      job_id: job.id,
      match_score: matchResult.match_score,
      evidenced_skills: matchResult.evidenced_skills,
      missing_skills: matchResult.missing_skills,
      partial_skills: matchResult.partial_skills,
      experience_alignment: matchResult.experience_alignment,
      scoring_breakdown: matchResult.scoring_breakdown,
      recommended_improvements: matchResult.recommended_improvements,
    });

    res.status(201).json({ match: savedMatch });
  } catch (err: any) {
    console.error('Job match error:', err);
    res.status(500).json({ error: 'Failed to execute job matching engine.' });
  }
});

app.delete('/api/matches/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const ok = db.deleteJobMatch(req.params.id, req.user!.id);
  if (!ok) {
    res.status(404).json({ error: 'Match not found.' });
    return;
  }
  res.json({ success: true });
});

// ==========================================
// SKILL-GAP COACH ROUTES
// ==========================================

app.get('/api/skills/goals', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const goals = db.getSkillGoals(req.user!.id);
  res.json({ goals });
});

app.post('/api/skills/generate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { missingSkills, targetRole, jobId } = req.body;
    if (!missingSkills || !Array.isArray(missingSkills) || missingSkills.length === 0) {
      res.status(400).json({ error: 'Missing skills array is required.' });
      return;
    }

    const profile = db.getProfile(req.user!.id);
    const candidateSummary = `${profile?.current_role || ''} with target ${targetRole || 'Software Engineering'}`;

    const roadmapItems = await gemini.generateSkillGoals(
      missingSkills,
      targetRole || 'Target Role',
      candidateSummary
    );

    // Save each generated goal
    const savedGoals = roadmapItems.map(item =>
      db.createSkillGoal(req.user!.id, {
        job_id: jobId,
        skill_name: item.skill_name,
        priority: item.priority as any,
        why_matters: item.why_matters,
        candidate_evidence: item.candidate_evidence,
        learning_objective: item.learning_objective,
        recommended_exercise: item.recommended_exercise,
        status: 'not_started',
        sort_order: item.sort_order || 1,
      })
    );

    res.status(201).json({ goals: savedGoals });
  } catch (err: any) {
    console.error('Skill generation error:', err);
    res.status(500).json({ error: 'Failed to generate personalized skill roadmap.' });
  }
});

app.post('/api/skills/goals', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { skill_name, priority, why_matters, candidate_evidence, learning_objective, recommended_exercise } = req.body;
    if (!skill_name || !learning_objective) {
      res.status(400).json({ error: 'Skill name and learning objective are required.' });
      return;
    }

    const goal = db.createSkillGoal(req.user!.id, {
      skill_name,
      priority: priority || 'medium',
      why_matters: why_matters || 'Important for target position readiness.',
      candidate_evidence: candidate_evidence || 'Independent study and practice.',
      learning_objective,
      recommended_exercise: recommended_exercise || 'Build a targeted project milestone.',
      status: 'not_started',
      sort_order: 99,
    });

    res.status(201).json({ goal });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save skill goal.' });
  }
});

app.patch('/api/skills/goals/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const updated = db.updateSkillGoal(req.params.id, req.user!.id, req.body);
  if (!updated) {
    res.status(404).json({ error: 'Skill goal not found.' });
    return;
  }
  res.json({ goal: updated });
});

app.delete('/api/skills/goals/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const ok = db.deleteSkillGoal(req.params.id, req.user!.id);
  if (!ok) {
    res.status(404).json({ error: 'Skill goal not found.' });
    return;
  }
  res.json({ success: true });
});

// ==========================================
// MOCK INTERVIEW STUDIO ROUTES
// ==========================================

app.get('/api/interviews/sessions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const sessions = db.getInterviewSessions(req.user!.id);
  res.json({ sessions });
});

app.get('/api/interviews/sessions/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const session = db.getInterviewSession(req.params.id, req.user!.id);
  if (!session) {
    res.status(404).json({ error: 'Interview session not found.' });
    return;
  }
  res.json({ session });
});

app.post('/api/interviews/sessions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetRole, interviewType, difficulty, totalQuestions, resumeId, jobId } = req.body;
    if (!targetRole) {
      res.status(400).json({ error: 'Target role is required.' });
      return;
    }

    const session = db.createInterviewSession(req.user!.id, {
      resume_id: resumeId,
      job_id: jobId,
      target_role: targetRole,
      interview_type: interviewType || 'technical',
      difficulty: difficulty || 'mid',
      total_questions: totalQuestions ? parseInt(totalQuestions, 10) : 5,
    });

    // Generate Question 1 immediately
    let resumeContext = '';
    if (resumeId) {
      const resume = db.getResume(resumeId, req.user!.id);
      resumeContext = resume?.raw_text || '';
    }

    let jobReqs = '';
    if (jobId) {
      const job = db.getJob(jobId, req.user!.id);
      jobReqs = JSON.stringify(job?.parsed_requirements || {});
    }

    const qData = await gemini.generateAdaptiveQuestion(
      session.target_role,
      session.interview_type,
      session.difficulty,
      resumeContext,
      1,
      session.total_questions,
      []
    );

    const question = db.addInterviewQuestion(req.user!.id, session.id, {
      question_number: 1,
      question_text: qData.question_text,
      question_type: qData.question_type || session.interview_type,
      target_competency: qData.target_competency,
      context_clue: qData.context_clue,
    });

    res.status(201).json({ session, question });
  } catch (err: any) {
    console.error('Session initiation error:', err);
    res.status(500).json({ error: 'Failed to initiate mock interview session.' });
  }
});

app.post('/api/interviews/sessions/:id/submit-answer', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { questionId, answerText } = req.body;
    if (!questionId || !answerText || !answerText.trim()) {
      res.status(400).json({ error: 'Question ID and answer text are required.' });
      return;
    }

    const fullSession = db.getInterviewSession(req.params.id, req.user!.id);
    if (!fullSession) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const question = fullSession.questions.find(q => q.id === questionId);
    if (!question) {
      res.status(404).json({ error: 'Question not found in this session.' });
      return;
    }

    // Evaluate answer with Gemini
    const evaluation = await gemini.evaluateInterviewAnswer(
      question.question_text,
      answerText,
      fullSession.target_role,
      fullSession.interview_type,
      fullSession.difficulty
    );

    const { answer, feedback } = db.submitInterviewAnswer(
      req.user!.id,
      fullSession.id,
      question.id,
      answerText,
      {
        score: evaluation.score || 75,
        what_went_well: evaluation.what_went_well || 'Presented thoughtful perspective.',
        what_to_improve: evaluation.what_to_improve || 'Elaborate on specific technical decisions.',
        missing_points: evaluation.missing_points || [],
        suggested_approach: evaluation.suggested_approach || 'Frame with clear context and measurable results.',
        star_breakdown: evaluation.star_breakdown,
        follow_up_tip: evaluation.follow_up_tip,
      }
    );

    // Check if next question is needed
    const currentQCount = fullSession.questions.length;
    let nextQuestion = null;

    if (currentQCount < fullSession.total_questions) {
      // Build past QA context for adaptive generation
      const pastQA = fullSession.questions.map(q => {
        const qAns = q.id === questionId ? answerText : fullSession.answers.find(a => a.question_id === q.id)?.answer_text || '';
        const qScore = q.id === questionId ? (evaluation.score || 75) : fullSession.feedback.find(f => f.session_id === fullSession.id)?.score || 75;
        return { question: q.question_text, answer: qAns, score: qScore };
      });

      let resumeContext = '';
      if (fullSession.resume_id) {
        const resume = db.getResume(fullSession.resume_id, req.user!.id);
        resumeContext = resume?.raw_text || '';
      }

      const nextQData = await gemini.generateAdaptiveQuestion(
        fullSession.target_role,
        fullSession.interview_type,
        fullSession.difficulty,
        resumeContext,
        currentQCount + 1,
        fullSession.total_questions,
        pastQA
      );

      nextQuestion = db.addInterviewQuestion(req.user!.id, fullSession.id, {
        question_number: currentQCount + 1,
        question_text: nextQData.question_text,
        question_type: nextQData.question_type || fullSession.interview_type,
        target_competency: nextQData.target_competency,
        context_clue: nextQData.context_clue,
      });
    }

    res.json({ answer, feedback, nextQuestion, isCompleted: currentQCount >= fullSession.total_questions });
  } catch (err: any) {
    console.error('Answer submission error:', err);
    res.status(500).json({ error: 'Failed to evaluate answer.' });
  }
});

app.post('/api/interviews/sessions/:id/complete', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { summary, strengths, areasToImprove } = req.body;
    const session = db.completeInterviewSession(
      req.params.id,
      req.user!.id,
      summary || 'Interview session completed with balanced competency assessment.',
      strengths || ['Clear communication', 'Solid technical articulation'],
      areasToImprove || ['Quantify problem impact', 'Incorporate more structured examples']
    );

    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    res.json({ session });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to finalize session.' });
  }
});

// ==========================================
// UNIFIED DASHBOARD STATS ROUTE
// ==========================================

app.get('/api/dashboard/stats', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const profile = db.getProfile(userId);
  const resumes = db.getResumes(userId);
  const jobs = db.getJobs(userId);
  const matches = db.getJobMatches(userId);
  const goals = db.getSkillGoals(userId);
  const sessions = db.getInterviewSessions(userId);
  const activity = db.getRecentActivity(userId, 8);

  const completedSessions = sessions.filter(s => s.status === 'completed');
  const avgInterviewScore = completedSessions.length > 0
    ? Math.round(completedSessions.reduce((acc, s) => acc + (s.overall_score || 0), 0) / completedSessions.length)
    : 0;

  const topMatch = matches.length > 0
    ? matches.reduce((prev, curr) => (curr.match_score > prev.match_score ? curr : prev), matches[0])
    : null;

  const completedGoals = goals.filter(g => g.status === 'completed').length;

  res.json({
    profile,
    readinessScore: profile?.readiness_score || 35,
    counts: {
      resumes: resumes.length,
      jobs: jobs.length,
      matches: matches.length,
      goals: goals.length,
      completedGoals,
      interviews: sessions.length,
      completedInterviews: completedSessions.length,
    },
    topMatch,
    avgInterviewScore,
    priorityGaps: goals.filter(g => g.status !== 'completed').slice(0, 4),
    recentInterviews: sessions.slice(-3).reverse(),
    recentActivity: activity,
  });
});

// ==========================================
// SUPABASE DIRECT INTEGRATION ROUTES
// ==========================================

app.get('/api/supabase/status', async (_req: Request, res: Response) => {
  try {
    const status = await supabaseService.getStatus();
    const config = supabaseService.getRawConfig();
    res.json({ ...status, config });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to check Supabase status' });
  }
});

app.post('/api/supabase/config', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { url, key, serviceRoleKey } = req.body;
    if (!url || !key) {
      res.status(400).json({ error: 'Supabase URL and API Key are required.' });
      return;
    }
    supabaseService.saveConfig(url, key, serviceRoleKey);
    const status = await supabaseService.getStatus();
    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save Supabase config' });
  }
});

app.post('/api/supabase/sync', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseService.syncAllData(req.user!.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to sync data to Supabase.' });
  }
});

app.get('/api/supabase/data', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await supabaseService.fetchSupabaseData(req.user!.id);
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch data from Supabase' });
  }
});

app.post('/api/supabase/purge-fake', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseService.purgeFakeAccounts();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to purge fake accounts.' });
  }
});

app.delete('/api/supabase/records/:table/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { table, id } = req.params;
    const result = await supabaseService.deleteRecord(table, id);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete record from Supabase.' });
  }
});

// System check / Health check
app.get('/api/system/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// VITE DEV SERVER / PRODUCTION STATIC HOSTING
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CareerPilot AI Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
