# ALLO — Brand Coherence & Pruning Audit

## 1. Executive Verdict
ALLO is a highly functional, operational product that successfully differentiates itself from the parent "Velveteen Project" lab site through its system-in-motion aesthetic and real-time focus. It carries significant technical authority (mentioning CIR and stochastic models). However, it currently suffers from "thematic inflation"—leaning too heavily into dashboard tropes, overly dramatic "engine" language, and a visual system that occasionally trades Velveteen's "premium restraint" for generic SaaS "glow" effects.

## 2. What Already Works
- **Operational Specificity**: The real-time sensing focus and the use of technical artifacts (terminal windows, risk maps) align with the Velveteen "applied lab" identity.
- **Technical Authority**: Direct references to stochastic modeling (CIR+Poisson) and specific scientific inputs (Hydrus, Open-Meteo) build immediate trust.
- **Typographic Foundation**: The use of Space Grotesk and JetBrains Mono provides strong family coherence.
- **Multilingual Readiness**: The system is architected for internationalization, matching the parent's bilingual commitment.

## 3. What Should Be Pruned
- **Stack-Revealing Metadata**: The use of labels like `RECHARTS`, `SUPABASE LOGS`, and `LEAFLET ONLINE` in the UI is "themed dashboard" language. It breaks the "sober technical" tone by exposing internal implementation details as if they were features.
- **Theatrical Branding**: The "ENGINE CORE" and "DAEMON" terminology, while evocative, feels more like a themed interface than a serious professional tool.
- **Emoji Usage**: The `🌧️` emoji in the hero wordmark area weakens the premium perception and should be replaced by a more formal geometric or scientific symbol.
- **Visual "Glitter"**: The over-reliance on `ambient-glow`, `gradient-text`, and heavy `glass-card` effects should be pruned in favor of flatter, sharper, and more restrained surfaces.
- **Mixed Language in Hero**: The landing description should avoid mixing Spanish and English unless it is a deliberate bilingual design (like the parent site).

## 4. What Should Be Preserved as Product-Specific
- **Cobalt Blue Accent**: The use of Blue (`#3b82f6`) effectively separates the product from the parent lab's Teal, signaling "Climate/Operational" rather than "General Lab."
- **Terminal Visual**: The idea of a terminal "heartbeat" is excellent for ALLO's operational nature, though its execution needs to be less "hacker theme" and more "system monitor."
- **Data Density**: The KPI-heavy dashboard is appropriate for this domain and should not be simplified into a "marketing dashboard."

## 5. Section-by-Section Review
- **Hero**: Currently cluttered. The hierarchy between the parent lab name, the product name, and the descriptor is competing. The emoji and "Engine Core" language need to be replaced with authoritative, sober descriptors.
- **Dashboard**: Strongest in utility. Needs to remove implementation tags and refine the risk-level colors to feel less like a standard bootstrap template and more refined.
- **Auth Flow**: Relies on "gradient-text" and standard "glass-card" layouts. Needs more restraint to align with the "small-but-sharp" trust posture.
- **Navigation**: Sidebar is functional but the "brand-tag" and "sys-status" can be cleaned up to feel less like a template.

## 6. Visual System Diagnosis
- **Color Discipline**: The cobalt blue is good but needs to be paired with more muted, sober neutrals to avoid looking like a generic startup.
- **Interface Restraint**: The current system uses too many box-shadows and glows. Pruning these will enhance the "scientific instrument" feel.
- **Consistency**: There is a slight mismatch between the "landing" CSS variables and the "dashboard" CSS variables. These should be unified under a single, coherent product design system.

## 7. Product Storytelling Diagnosis
ALLO is currently framed as an "Engine" or a "Detector." To align with Velveteen, it should move toward being framed as a "Decision Support System" or an "Operational Framework." The story should be less about the "code running" (terminal outputs) and more about the "rigor of the decision" the system enables.

## 8. Prioritized Next Steps

### Fix now
- **Remove implementation tags**: Replace `RECHARTS`, `SUPABASE LOGS`, etc., with functional domain labels (e.g., `TIME SERIES`, `EVENT LOG`).
- **Standardize Language**: Clean up the hero copy to ensure a professional, consistent language posture (English primary, Spanish secondary).
- **Prune Emoji**: Remove the cloud emoji from the wordmark.

### Improve next
- **Hierarchy Refinement**: Clarify the relationship between Velveteen (parent) and ALLO (product) in the hero wordmark.
- **Visual Restraint Pass**: Reduce glow effects and shadows across the landing and dashboard.
- **Terminal Refinement**: Make the terminal visual less "dramatic" and more "analytical."

### Leave alone
- **Typography**: The font family choices are correct.
- **Color Palette**: Keep the cobalt blue as the core product differentiator.
- **Data Detail**: Do not simplify the model descriptions (CIR+, Poisson, etc.).

### Never do
- **Avoid "Magic" AI descriptions**: Never describe the system as "magic" or "infinite." Keep it grounded in its mathematical and operational reality.
- **No Redesign to Match Parent**: Do not change the blue to teal. Coherence, not uniformity.
