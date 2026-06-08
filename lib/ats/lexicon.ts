// Word lists for the rules-based resume↔JD matcher (lib/ats/match.ts).
//
// Everything here is deterministic and offline. The matcher rewards exact
// matches of meaningful terms (tools, systems, skills, methodologies, metrics,
// business terms) and ignores generic filler, so a job's score reflects how
// well a resume's wording aligns with the job description — not preferences,
// location, or company.

/** Hard stopwords: grammatical glue. A phrase may never start/end with one. */
export const STOPWORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "of", "to", "in",
  "on", "at", "by", "for", "with", "from", "as", "is", "are", "be", "been",
  "being", "was", "were", "it", "its", "this", "that", "these", "those", "we",
  "us", "our", "you", "your", "they", "them", "their", "he", "she", "his",
  "her", "i", "me", "my", "will", "would", "can", "could", "should", "may",
  "might", "must", "do", "does", "did", "has", "have", "had", "not", "no",
  "into", "out", "up", "down", "over", "under", "than", "too", "very", "so",
  "such", "via", "per", "about", "above", "below", "between", "across",
  "within", "without", "through", "during", "before", "after", "more", "most",
  "all", "any", "each", "few", "some", "other", "own", "same", "who", "whom",
  "which", "what", "when", "where", "why", "how", "also", "etc", "e.g",
]);

/**
 * Generic / common business filler. Penalized — excluded from keyword candidacy
 * so a resume can't score by parroting buzzwords. (Still allowed *inside* a
 * phrase, just never as a standalone keyword or a phrase's edge token.)
 */
export const GENERIC_WORDS = new Set<string>([
  "experience", "experienced", "years", "year", "responsible",
  "responsibilities", "responsibility", "team", "teams", "work", "working",
  "ability", "able", "strong", "excellent", "great", "good", "best", "highly",
  "deeply", "passionate", "passion", "looking", "join", "joining", "role",
  "roles", "opportunity", "opportunities", "candidate", "candidates",
  "including", "include", "includes", "new", "help", "helping", "world",
  "company", "companies", "growth", "fast", "paced", "environment", "using",
  "use", "used", "well", "drive", "driven", "driving", "impact", "mission",
  "value", "values", "skills", "skill", "knowledge", "understanding", "ensure",
  "ensuring", "provide", "providing", "support", "supporting", "across",
  "various", "multiple", "key", "core", "related", "etc", "plus", "based",
  "preferred", "required", "requirement", "requirements", "qualifications",
  "qualified", "must", "nice", "bonus", "people", "person", "individual",
  "global", "leading", "leader", "industry", "businesses", "needs", "ideal",
  "proven", "track", "record", "demonstrated", "successful", "success",
  "ownership", "owner", "high", "quality", "level", "levels", "day", "days",
  "time", "make", "making", "take", "taking", "want", "love", "like", "every",
  "things", "thing", "part", "partner", "partners", "work", "job", "position",
  "hire", "hiring", "career", "careers", "apply", "benefits", "salary",
  "compensation", "remote", "hybrid", "onsite", "office", "location", "need",
  "bring", "haves", "must-haves", "senior", "junior", "staff", "principal",
  "lead", "manager", "director", "head", "vp", "intern",
  // HTML-entity-name and contraction leftovers from scraped descriptions
  "nbsp", "amp", "quot", "apos", "lt", "gt", "rsquo", "lsquo", "ndash",
  "mdash", "hellip", "ll", "ve", "re", "don", "doesn", "isn", "didn", "won",
  "couldn", "wouldn", "shouldn", "aren",
  // Geography / placement — must never influence the score (no location credit)
  "united", "states", "usa", "us", "uk", "eu", "emea", "apac", "york", "san",
  "francisco", "nyc", "sf", "bay", "area", "city", "states", "canada", "ireland",
  "london", "berlin", "paris", "india", "country", "countries", "region",
  "timezone", "relocation", "visa", "sponsorship", "authorization",
  // Benefits / compensation / boilerplate
  "pto", "401k", "hra", "fsa", "hsa", "dental", "vision", "medical", "health",
  "healthcare", "insurance", "equity", "parental", "birthing", "bonding",
  "leave", "weeks", "week", "month", "months", "holiday", "vacation", "stipend",
  "wellness", "reimbursement", "perks", "perk", "bonus", "bonuses", "401",
  "eeo", "disability", "veteran", "gender", "race", "religion", "age",
  "orientation", "accommodation", "accommodations", "applicant", "applicants",
  "employer", "diverse", "diversity", "inclusion", "belonging", "equal",
  "background", "checks", "range", "ranges", "base", "annual", "hourly",
  "prior", "advisors", "only", "etc", "via", "approximately",
  "rrsp", "dpsp", "espp", "401k", "457b", "addd", "ltd", "std",
]);

/**
 * Domain gazetteer: high-signal single tokens (languages, frameworks, data,
 * cloud, devops, ML, security, business/CS, methodologies, metrics). Matching
 * one of these counts for more than an ordinary content word.
 */
export const DOMAIN_TERMS = new Set<string>([
  // languages
  "python", "java", "javascript", "typescript", "golang", "go", "rust", "ruby",
  "scala", "kotlin", "swift", "php", "c++", "c#", "objective-c", "perl", "r",
  "matlab", "sql", "nosql", "bash", "shell", "solidity", "haskell", "elixir",
  // frameworks / web
  "react", "reactjs", "angular", "vue", "vuejs", "svelte", "node", "nodejs",
  "next.js", "nextjs", "nuxt", "django", "flask", "fastapi", "rails", "spring",
  "express", "graphql", "rest", "grpc", "redux", "tailwind", "webpack",
  "html", "css", "sass", "jquery", "dotnet", ".net", "laravel", "symfony",
  // data / analytics
  "etl", "elt", "spark", "hadoop", "kafka", "airflow", "dbt", "snowflake",
  "redshift", "bigquery", "databricks", "tableau", "looker", "powerbi",
  "pandas", "numpy", "pytorch", "tensorflow", "keras", "scikit-learn",
  "sklearn", "warehouse", "warehousing", "etls", "postgres", "postgresql",
  "mysql", "mongodb", "redis", "elasticsearch", "cassandra", "dynamodb",
  "clickhouse", "presto", "trino", "hive", "flink", "kinesis", "segment",
  // cloud / devops
  "aws", "gcp", "azure", "kubernetes", "k8s", "docker", "terraform", "ansible",
  "jenkins", "ci", "cd", "cicd", "linux", "unix", "microservices", "serverless",
  "lambda", "ec2", "s3", "rds", "eks", "gke", "helm", "prometheus", "grafana",
  "datadog", "observability", "nginx", "kafka", "rabbitmq", "pulsar",
  "cloudformation", "argocd", "gitops", "devops", "sre",
  // ml / ai
  "ml", "ai", "nlp", "llm", "llms", "embeddings", "transformers", "transformer",
  "rag", "genai", "mlops", "inference", "fine-tuning", "classification",
  "regression", "clustering", "recommendation", "ranking", "vector",
  "computer-vision", "deeplearning",
  // security
  "soc2", "gdpr", "hipaa", "pci", "oauth", "oauth2", "saml", "sso", "encryption",
  "siem", "iam", "owasp", "pentest", "vulnerability", "compliance", "fedramp",
  // business / CS / sales / finance
  "saas", "b2b", "b2c", "crm", "salesforce", "hubspot", "marketo", "qbr",
  "qbrs", "churn", "retention", "upsell", "cross-sell", "onboarding", "arr",
  "mrr", "nps", "csat", "kpi", "kpis", "okr", "okrs", "roi", "gtm", "pipeline",
  "forecast", "forecasting", "p&l", "ebitda", "underwriting", "reconciliation",
  "gaap", "fp&a", "ledger", "invoicing", "procurement", "logistics",
  "fulfillment", "merchandising", "seo", "sem", "ppc", "ctr", "cac", "ltv",
  "attribution", "segmentation", "cohort", "funnel", "activation",
  // product / pm
  "roadmap", "backlog", "prd", "wireframe", "wireframes", "prototyping",
  "personas", "discovery", "experimentation", "telemetry",
  // methodologies / quality / metrics
  "agile", "scrum", "kanban", "waterfall", "tdd", "bdd", "ci/cd", "latency",
  "throughput", "uptime", "sla", "slas", "slo", "sli", "availability",
  "scalability", "concurrency", "caching", "sharding", "partitioning",
  "idempotent", "load-testing",
  // design / other tools
  "figma", "sketch", "jira", "confluence", "git", "github", "gitlab", "notion",
  "looker", "amplitude", "mixpanel", "segment", "snowplow",
]);

/**
 * Known multi-word phrases. If a JD contains one of these (in normalized,
 * de-hyphenated form), it becomes a high-weight phrase target — these are the
 * "exact ATS phrases" the matcher most rewards.
 */
export const KNOWN_PHRASES: string[] = [
  "machine learning", "deep learning", "natural language processing",
  "large language models", "computer vision", "feature engineering",
  "model training", "data pipeline", "data pipelines", "data engineering",
  "data analysis", "data analytics", "data science", "data warehouse",
  "data modeling", "data governance", "etl pipelines", "real time",
  "distributed systems", "system design", "software engineering",
  "software development", "object oriented", "rest api", "rest apis",
  "api design", "version control", "unit testing", "integration testing",
  "end to end", "a b testing", "ci cd", "continuous integration",
  "continuous delivery", "continuous deployment", "infrastructure as code",
  "site reliability", "incident management", "root cause", "post mortem",
  "on call", "service level agreement", "high availability", "fault tolerance",
  "cross functional", "stakeholder management", "project management",
  "product management", "product roadmap", "product strategy", "go to market",
  "user research", "user experience", "design system",
  "customer success", "customer success operations", "customer experience",
  "account management", "revenue operations", "sales operations",
  "business development", "demand generation", "lead generation",
  "pipeline management", "quarterly business review", "quarterly business reviews",
  "operating cadence", "business reviews", "executive presentations",
  "churn reduction", "customer onboarding", "customer retention",
  "financial modeling", "financial analysis", "risk management",
  "supply chain", "process improvement", "change management",
  "people management", "team leadership", "technical leadership",
];
