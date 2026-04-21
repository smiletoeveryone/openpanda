# Professional Summarizer Skill — Complete Guide

## Overview

The `summarizer` skill transforms any content into **executive-grade summaries** (100-1000 words) suitable for boardrooms, research teams, and strategic decision-makers. Each summary is rigorous, data-driven, and clearly marked as complete.

**Key Features:**
- ✓ Adaptive length based on source material
- ✓ Rigorous professional standards (no fluff, preserved specificity)
- ✓ Strategic implications for decision-makers
- ✓ Clear completion marker so readers know summary is finished
- ✓ Content-type-aware formatting (research, business, technical, news)

---

## When to Use

- 📊 **Executive Briefings** — Board presentations, C-suite alignment
- 🔬 **Research & Academia** — Journal articles, dissertations, conference papers
- 📰 **News & Current Events** — Industry trends, market developments, competitive moves
- 📋 **Long Documents** — Reports, proposals, whitepapers, policies
- 💻 **Technical Deep-Dives** — Architecture docs, design specs, RFPs
- 💼 **Business Analysis** — Market reports, investor updates, strategic plans
- 🎤 **Meetings & Interviews** — Transcripts, podcast summaries, recordings

---

## How to Apply the Skill

### In Chat

```bash
# Start the skill
/skill summarizer

# Then paste your content
```

### With Specific Request

```bash
/skill summarizer

# Then specify what you need:
# "Summarize this for our C-suite" (executive focus)
# "Create a technical summary for engineers" (implementation focus)
# "Extract key financial metrics" (investor focus)
```

---

## What You Get: The Professional Structure

### **1. Executive Summary**
- **Length:** 1-2 sentences, bold text
- **Purpose:** Captures the absolute core finding
- **Example:** "Cloud spend exceeded on-premise for the first time in 2024, driven by AI workload migration and staffing efficiency gains, marking a structural inflection in enterprise IT."

### **2. Key Findings or Arguments**
- **Format:** 3-7 bullets, each with supporting metric
- **Quality:** Specific numbers, not vague claims
- **Bad:** "Significant cost reduction"
- **Good:** "40% latency reduction; inference cost drops from $0.12 to $0.07 per 1000 requests"

### **3. Implications** (2-3 substantial paragraphs)
The heart of professional summaries. Covers:
- **Paragraph A:** Why this matters (market gap, competitive advantage, research significance)
- **Paragraph B:** Who's affected and how (stakeholder impact with specificity)
- **Paragraph C:** Future outlook (market shifts, adoption timeline, dependencies)

### **4. Actionable Recommendations**
- **Format:** By audience, each with specific action
- **Example:**
  - **For: CFO** — Negotiate multi-year cloud commitments now to lock pricing
  - **For: Engineering Leadership** — Prioritize hiring cloud-native and AI specialists
  - **For: Board** — Evaluate if your legacy infrastructure puts you at strategic disadvantage

### **5. Limitations & Caveats**
- **Never hidden:** Explicitly states scope boundaries
- **Protects credibility:** Shows you understand what wasn't tested/proven
- **Examples:**
  - "Study limited to ResNet/MobileNet; Vision Transformers untested"
  - "Data from North America; Asian markets have different dynamics"
  - "Assumes enterprise scale; may not apply to mid-market"

### **6. Completion Marker**
- **Always present:** `✓ Summary Complete` or `— End of Summary —`
- **Why it matters:** Signals that nothing was cut off or lost
- **Professional signal:** Shows attention to detail

---

## Length Guide

| Source Volume | Summary Length | Examples |
|---|---|---|
| **50-500 words** | 100-200 words | Twitter thread, short blog post, press release |
| **500-2,000 words** | 300-500 words | Medium-length article, interview, case study |
| **2,000-5,000 words** | 600-800 words | White paper, research abstract, detailed report |
| **5,000+ words** | 900-1,000 words | Book chapter, dissertation, comprehensive analysis |

---

## Real-World Examples

### Example 1: Research Paper Summary

**Source:** Academic paper on quantum computing advancement (8,000 words)

**Your prompt:**
```
/skill summarizer

Summarize this quantum computing paper for a VP of R&D considering investment.
[paste paper]
```

**Output:**

**Executive Summary**
Researchers achieved 1000-qubit coherence using error-correction techniques, reducing quantum bit flip rates by 97% and demonstrating proof-of-concept for practical quantum computing at scale—enabling new applications in materials science and optimization problems within 3-5 years.

**Key Findings**
• **1000-qubit stability achieved** — Previous record: 127 qubits; achieved through surface codes and active error correction; coherence time extended from 50μs to 1.2ms
• **Error rates drop 97%** — Quantum bit flip rate reduced from 0.1% to 0.003% per gate; below theoretical threshold for fault-tolerant computation
• **Room-temperature operation demonstrated** — Previous systems required cryogenic temps; new approach operates at 4K (vs. 10mK), reducing infrastructure costs by estimated 60%
• **Materials science application proven** — Successful simulation of nitrogen fixation reaction; computation would take classical computers 10,000+ years
• **Timeline to productization: 3-5 years** — Authors estimate commercial quantum computers viable by 2027-2029; dependent on manufacturing scale-up

**Implications**
This breakthrough moves quantum computing from "theoretically possible" to "practically imminent." The 1000-qubit milestone is significant: it's the threshold where quantum advantage becomes likely for real-world problems in cryptography, drug discovery, and optimization.

For organizations investing in quantum R&D (pharma, finance, tech), this paper signals that strategic positioning in quantum-ready algorithms and problem formulation is now urgent. Organizations that publish results or build quantum-optimized software in the next 18 months will lead adoption when quantum hardware scales.

For infrastructure and cloud providers, this implies a 3-5 year runway to build quantum-as-a-service offerings. AWS, Azure, and Google are already investing; smaller players should consider partnerships or acquisition strategies. The first quantum cloud provider with accessible APIs and strong performance claims will capture significant early value.

**Recommendations for Decision-Makers**
• **For: VP of R&D** — Allocate 10-20% of quantum research budget to error correction and scaling; this is now the bottleneck, not fundamental science. Consider partnerships with academic labs publishing in this space.
• **For: Corporate Strategy** — Quantum-optimized applications in your industry (logistics, finance, materials) should be scoped now; first-mover advantage is 2-3 years away.
• **For: Investor Relations** — This validates quantum computing as a real technology pathway; consider disclosing quantum strategy or partnerships to investors as table-stakes for forward-looking tech companies.

**Limitations & Scope**
• **Laboratory conditions** — Experiments in controlled environment; real-world hardware integration not demonstrated
• **Single vendor** — Results from one research group; reproducibility by other institutions pending (peer review status: in press)
• **Cost and accessibility unknown** — System cost not disclosed; assumes breakthrough in manufacturing to reach commercial scale

✓ Summary Complete

---

### Example 2: Business Report Summary

**Source:** Market analysis report on SaaS economics (12,000 words)

**Your prompt:**
```
/skill summarizer

Create an executive summary of this SaaS market report for the board.
Focus on competitive threats and market shifts.
[paste report]
```

**Output:**

**Executive Summary**
SaaS market growth is decelerating (24% CAGR vs. 30% historically) as consolidation accelerates, but AI-driven automation creates new opportunities for vertical players and integration platforms. Market leaders (Salesforce, ServiceNow) face margin compression from customer demands for AI-native pricing, while startups with narrow focus + strong AI differentiation are achieving 3-5x higher growth rates.

**Key Findings**
• **Growth deceleration signals maturity** — SaaS market growing 24% CAGR (2024-2026), down from 30% in 2019-2023; horizontal players (CRM, HCM) face 10-15% growth; vertical/niche players 35-50%
• **Consolidation accelerates** — Top 10 vendors now control 35% market share (vs. 20% in 2019); mid-market vendors facing margin pressure and forced M&A activity
• **AI pricing models emerging** — Customers demand "AI co-pilot" features at no premium (42% customer demand); vendors exploring usage-based and outcome-based models to maintain margins
• **Vertical SaaS outpacing horizontal** — Vertical SaaS (construction, legal, healthcare tech) growing 45-60%; horizontal CRM/HCM growing 15-20%; market shift reflects customer desire for industry-specific workflows
• **Integration/composability winning** — Platforms enabling data/workflow integration (Zapier, Make, Supabase) growing 65%+ and capturing share from monolithic platforms

**Implications**
The SaaS market is at an inflection. Horizontal platforms built on relational databases and pre-defined workflows are commoditizing. Customers increasingly prefer integration platforms and vertical specialists that combine domain expertise with AI automation. For vendors and investors, this means:

**For incumbents:** Margin compression is real. Salesforce, ServiceNow, and HubSpot must invest in AI differentiation and justify premium pricing through measurable outcomes (revenue impact, efficiency gains). R&D intensity rising while per-dollar revenue stagnating creates structural pressure.

**For startups and challengers:** Narrow focus + strong AI is the winning formula. Vertical SaaS startups (construction tech, legal tech, healthcare tech) with AI-native workflows are capturing wallet share. Startups combining ease-of-use with deep industry knowledge can achieve 3-5x faster growth than horizontal players.

**For investors:** The 10-year SaaS consolidation narrative is ending. 2024-2026 mark the transition to a new playbook: winners are vertical-first, AI-native, and obsessed with customer outcomes. Predict significant M&A activity as mid-market vendors acquired by larger groups seeking scale or as acquirers of pure-play AI startups.

**Recommendations for Board / Strategy**
• **For: SaaS CEO** — If you're horizontal, announce bold AI roadmap and outcome-based pricing by Q2 2025 or risk 3-5 year value destruction. If you're vertical, accelerate AI differentiation and land-and-expand strategy; you're in a 5-year bull market.
• **For: Enterprise CIO** — Evaluate your existing SaaS stack: are you paying for breadth (Salesforce, SAP) you don't use? Consider rationalizing to best-of-breed vertical solutions + integration platform. 30-40% cost reduction is achievable.
• **For: Investor / Board** — Benchmark your software vendors' AI maturity: are they shipping AI features or just announcing them? Real AI ROI appears 2026+. Demand vendor roadmaps that tie AI to measurable customer outcomes.

**Limitations & Scope**
• **Revenue and data sourced from Gartner, IDC, company disclosures** — Private market data incomplete; true growth rates may vary
• **Excludes open-source and self-hosted alternatives** — Cloud-native and open alternatives capturing segment not fully quantified in traditional market reports
• **Assumes continued enterprise cloud adoption** — Doesn't model scenarios where on-premise alternatives re-accelerate (unlikely but risk factor)

✓ Summary Complete

---

## Tips for Best Results

### **Before Summarizing**
1. **Provide the full content** — Partial summaries are weaker
2. **Include source context** — "This is a Q3 earnings report from Stripe" helps set tone
3. **Specify your audience** — "For our board" vs. "For technical teams" adjusts depth and language
4. **Highlight priority sections** — "Focus on competitive threats" or "Emphasize financial metrics"

### **After You Receive the Summary**
1. **Verify key numbers** — Cross-check against source
2. **Check completion marker** — Confirms nothing was cut off
3. **Share with stakeholders** — Summary is shareable as-is, no editing needed
4. **Export for records** — Use `/export` to save to markdown

### **Prompt Templates**

**For executives:**
```
/skill summarizer

Create a board-ready summary. Focus on strategic implications, 
competitive threats, and decisions we need to make.
[paste content]
```

**For technical teams:**
```
/skill summarizer

Summarize this architecture document for our engineering leaders.
Highlight implementation complexity, risk areas, and dependencies.
[paste content]
```

**For investors:**
```
/skill summarizer

Summarize this market report for investor communications.
Focus on market size, growth rates, and competitive dynamics.
[paste content]
```

**For researchers:**
```
/skill summarizer

Summarize this research for our academic peer community.
Preserve all statistical details, methodology, and caveats.
[paste content]
```

---

## Understanding Completion Markers

Every professional summary **ends with a completion marker:**

```
✓ Summary Complete
```

or

```
— End of Summary —
```

**Why this matters:**
- Confirms nothing was lost or truncated
- Signals professional attention to detail
- Clear boundary between summary and any follow-up text
- Prevents confusion in long documents

If you don't see a completion marker, the summary may have been interrupted. Request it to be re-run.

---

## Quality Checklist — How Professional Summaries Are Judged

✅ **Standalone** — Fully understandable without the original text
✅ **Specific** — Numbers, dates, names preserved (not rounded)
✅ **Causal** — Uses "because," "resulted in," "therefore" (not just listing)
✅ **Rigorous** — Distinguishes fact from opinion; flags uncertainty
✅ **Actionable** — Implications are specific and decision-useful
✅ **Honest** — Limitations acknowledged in caveats section
✅ **Complete** — Ends with ✓ completion marker
✅ **Length appropriate** — Matches source volume (100-1000 words)

---

## When to Use Other Skills

| Need | Skill | Why |
|---|---|---|
| Summarize + find sources | `/skill analyst` | Combines research and synthesis |
| Summarize + multiple sources | `/skill research` | Gathers external data + summary |
| Summarize + refine language | `/skill editor` | Polishes summary further |
| Summarize + long-form expansion | `/skill writer` | Creates detailed report from summary |

---

## Troubleshooting

### Summary seems too long/short
- **Too long?** Specify "executive brief only" or "under 300 words"
- **Too short?** Provide longer source material or request "comprehensive analysis"

### Missing important details
- Highlight specific sections: "Focus especially on Section 3 and appendix"
- Request "detailed findings with all supporting metrics"

### Tone not professional enough
- Specify audience: "For our board" or "For C-suite distribution"
- Request "executive summary style" vs. "academic summary"

### No completion marker
- The summary may have been interrupted
- Request it again: "Complete the summary and add the completion marker"

---

## Pro Tips

**1. Combine with `/search`**
```
# Search your past conversations for relevant context
/search previous AI investments

# Then summarize new market research:
/skill summarizer
Summarize this in context of our past AI strategy discussions.
```

**2. Use for Meeting Prep**
```
# Get summary of competitor announcement before strategy meeting
/skill summarizer

Summarize this competitor press release for our product team.
What are the implications for our roadmap?
```

**3. Create Decision Briefs**
```
/skill summarizer

Create a one-page decision brief on this vendor proposal.
Format for immediate board review (include: cost, risk, timeline).
```

**4. Build Institutional Knowledge**
```
/skill summarizer
then
/export [name]

# Creates shareable, permanent summary in ~/.openpanda/exports/
# Share with team for onboarding or historical reference
```

---

## Professional Standards You Can Expect

✓ **No vague language** — Every claim backed by data or evidence
✓ **Preserved nuance** — Complex topics not oversimplified
✓ **Credible attribution** — Specific sources and names cited
✓ **Honest about limitations** — Unknown unknowns disclosed
✓ **Strategic implications** — "So what?" answered for leaders
✓ **Actionable recommendations** — Specific steps, not generic advice
✓ **Clear completion** — Summary marked complete so nothing lost
✓ **Audience-appropriate** — Tone matches intended recipients

---

## Example: Before & After

### Before (Generic Summary)
"This article discusses cloud computing and how companies are moving there. Cloud is important for AI. Costs are lower and it's faster. More companies will use cloud in the future."

### After (Professional Summary)
"Enterprise cloud spend surpassed on-premise for the first time in 2024, representing a structural inflection driven primarily by AI workload economics (40% cost reduction vs. on-premise) and staffing efficiency gains (35% headcount reduction). **Implications:** Organizations delaying cloud migration face competitive disadvantage; for CIOs, budget planning should allocate 70% to cloud by 2026. **Recommendation:** CFO to negotiate multi-year hyperscaler commitments now for pricing locks. **Limitations:** Analysis covers North America/Europe only; regulated industries (pharma, defense) may remain 40%+ on-premise through 2027."

✓ Summary Complete
