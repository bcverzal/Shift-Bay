# Shift Bay Business Plan Draft

## Working Summary

Shift Bay is a restaurant scheduling and labor-planning application built around a simple operational truth: managers rarely build schedules by filling employee rows first. They build from the shifts that need coverage, then work through available people, warnings, training limits, requests off, floor plans, and business needs until the week is usable.

The core product is a weekly scheduling workflow where unassigned shifts live in the Shift Bay, then get assigned to eligible employees with clear warnings, print-ready schedules, floor plans, request-off handling, and eventually sales-informed staffing suggestions.

The near-term business goal is to turn the current working restaurant prototype into a stable single-location product, then use the real restaurant implementation as proof that Shift Bay saves management time, reduces scheduling mistakes, and creates better shift coverage decisions.

## Product Positioning

Shift Bay should not be positioned as a generic calendar or another basic scheduler. The stronger position is:

> Shift Bay helps restaurant managers build better weekly schedules faster by turning required shifts, staff availability, coverage needs, floor plans, and real operating constraints into one visual workflow.

The differentiator is the Shift Bay itself: a queue of open shifts that represents the remaining work. The user can sort, skip, assign, review, and print from that workflow instead of hunting through a blank grid.

## First Customer

The first ideal customer is not every business that schedules employees. The first customer should be narrow:

- Full-service restaurants
- Banquet/event-heavy restaurants
- Restaurants with breakfast/lunch/dinner service periods
- Independently operated restaurants or small groups
- Managers who currently build schedules in tools they dislike, then manually prepare floor plans

This customer has enough scheduling complexity to feel the pain, but not enough internal software support to solve it themselves.

## Problems Shift Bay Solves

- Weekly schedules take too long to build.
- Existing scheduling systems are often awkward for actual schedule construction.
- Managers must cross-reference availability, ROs, training, role eligibility, closers, doubles, clopens, and coverage needs.
- Floor plans are often handwritten after the schedule is built.
- Banquets and events create labor needs that are easy to miss.
- Printing formats are usually not designed around how managers actually run a shift.
- Historical schedules and future sales data are not used enough to improve staffing decisions.

## Current Prototype Proof

Shift Bay has already crossed an important milestone: it has been used to complete at least one real weekly restaurant schedule from start to finish.

Current proof points to track:

- Time required to build a schedule before Shift Bay.
- Time required to build a schedule with Shift Bay.
- Number of missed ROs or corrected conflicts.
- Number of floor plans printed from the app.
- Manager feedback from people using printed schedules/floor plans.
- How much time is saved by printing floor plans instead of handwriting them.

These should become the first case study.

## Minimum Sellable Product

Before charging outside customers, Shift Bay should reliably support:

- Login and manager permissions.
- Cloud-hosted schedule data.
- Multi-location/sandbox support.
- Employee profiles with roles, availability, training, pay, notes, and active/archive status.
- Weekly schedule grid.
- Single-day view.
- Shift Bay open-shift queue.
- Weekly templates.
- Request-off import/manual entry.
- Staff self-service for viewing schedules, submitting request-offs, submitting availability changes, and requesting shift pickup/release with manager approval.
- Conflict warnings.
- Compact schedule printing.
- Floor plan printing.
- Basic audit history.
- Backup/export safety.
- A guided tutorial or onboarding path.

The product does not need advanced sales intelligence before first revenue, but the architecture should leave room for it. Staff self-service is more important to market readiness than the advanced analytics suite because restaurants will expect online request-offs and shift coverage workflows from a scheduling product.

## Future Differentiators

The long-term version becomes more than scheduling:

- Sales projection based labor suggestions.
- Server/bartender performance by shift.
- Tip percentage and sales per shift analysis.
- Smarter automatic scheduling.
- Hiring need analysis based on availability gaps.
- Event/banquet labor integration.
- Employee mobile/browser portal for ROs, availability, schedules, shift trades, and coverage requests.
- Floor-plan designer with section assignment and server strength balancing.
- Restaurant group dashboard across multiple locations.
- Cross-location labor sharing for restaurant groups, allowing managers to request coverage help from sister locations and allowing eligible employees to pick up approved shifts across locations.
- Long-term earned-tip or earned-wage access, likely through payroll/fintech partnerships rather than direct money movement in the first version.

## Revenue Model

Likely pricing should be subscription based.

Potential tiers:

- Single Location Basic: scheduling, templates, ROs, printing, floor plans.
- Single Location Pro: analytics, sales projections, labor suggestions, advanced reporting.
- Multi-Location: group-level controls, shared templates, location switching, manager roles.
- Multi-Location Labor Network: cross-location staffing visibility, coverage requests, shared employee eligibility, and shift pickup workflows.
- Setup/Import Service: one-time fee for employee import, template setup, floor plan setup, and manager training.

Early pricing should be tested carefully. A realistic first target might be a monthly price low enough for one restaurant manager/GM to justify without a long approval process, plus optional setup help.

## Go-To-Market Strategy

Phase 1: Internal Proof

- Use Shift Bay every week at the current restaurant.
- Track time saved and issues caught.
- Get feedback from managers using floor plans and printed schedules.
- Stabilize cloud-hosted prototype.

Phase 2: Friendly Review

- Give demo/sandbox access to trusted restaurant people and technical reviewers.
- Let them use fake data without touching the live restaurant.
- Collect usability feedback and objections.

Phase 3: Pilot

- Find one or two outside restaurants willing to test.
- Offer white-glove setup.
- Charge little or nothing initially if needed, but document the value.

Phase 4: Paid Early Access

- Charge a monthly subscription for restaurants that continue using it.
- Keep onboarding personal.
- Use feedback to harden the product before broader sales.

## Ownership And Legal Risk

This needs attorney review before selling seriously.

Important questions:

- Was any code written on company-owned equipment?
- Was any development done while clocked in or expected to be performing restaurant duties?
- Did the company explicitly authorize or fund the work?
- Is there an employment agreement that assigns inventions or work product to the company?
- Can the restaurant receive a usage license without ownership claims?
- Should Shift Bay be owned by an LLC?
- Should the name and logo be trademark searched and eventually registered?

Recommended direction:

- Keep the GitHub repository under personal control.
- Avoid using company-owned devices for development.
- Track major development dates and where work was done.
- Consider creating a simple written agreement before company-wide use.
- Speak with a Wisconsin attorney before charging the employer or external customers.

## Funding Options

Low-cost path:

- Continue part-time development while working.
- Use the current restaurant as proof.
- Keep hosting costs low.
- Charge for setup/support once the product is stable enough.

Possible outside funding:

- Small business loan.
- Friends/family investment.
- Local entrepreneur grants.
- Restaurant group pilot contract.
- Accelerator only if the product becomes broader SaaS.

Given credit concerns and early-stage uncertainty, the safest path is likely bootstrapping until there is measurable proof of value.

## Key Risks

- The product becomes too complex for normal managers.
- Printing and floor plans remain too custom per restaurant.
- Scheduling rules vary widely between restaurants.
- Cloud save/version conflicts could damage trust.
- Existing systems like Ctuit remain required for official posting.
- Legal ownership issues if employer relationship is unclear.
- Too much time spent building advanced features before the core workflow is stable.
- Cross-location labor sharing could create privacy, permission, payroll, travel, overtime, and approval issues if not designed carefully.
- Earned wage or tip access would move Shift Bay into regulated payroll/financial-services territory and should not be built without legal, payroll, and compliance guidance.

## Near-Term Roadmap To Business Readiness

1. Stabilize cloud version and multi-location sandbox.
2. Finish trustworthy RO import.
3. Make templates and Shift Bay workflow intuitive enough for another manager to use.
4. Build the Staff Portal MVP: my schedule, request-offs, availability changes, shift release/pickup, and manager approval.
5. Build tutorial/onboarding.
6. Add manager audit/change history.
7. Make floor plan printing reliable and configurable.
8. Create demo data for reviewers.
9. Track real time savings for several schedule cycles.
10. Draft ownership/licensing questions for attorney.
11. Prepare a short pitch/demo script.

## Multi-Unit Labor Sharing Concept

For restaurant groups, Shift Bay could eventually become a labor network inside the organization. If one location cannot fill a shift, that manager could request help from another location. The receiving manager could approve or decline the request, and approved shifts could be offered to eligible employees who are trained for that role and location.

The first version should avoid exposing full schedules across the company. A safer first design would show limited coverage signals:

- Which locations have available eligible employees.
- Which employees are approved to work at multiple locations.
- Whether a requested shift would create overtime, clopen, availability, or travel issues.
- Whether the employee's home manager approval is required.
- Whether the borrowing location manager approval is required.

This can become a strong feature for multi-unit restaurant groups because it turns staffing gaps into an organized internal coverage workflow instead of a string of texts and phone calls.

Important future design questions:

- Who can see employees from another location?
- Does the home location manager approve before the employee sees the request?
- Does the employee opt in to cross-location work?
- How are travel time, mileage, overtime, and payroll location handled?
- Can borrowed labor be tracked as a separate labor category?
- Can staff see open shifts at other locations only after manager approval?

## Earned Tip And Earned Wage Access Concept

Early access to earned tips or earned wages could be a valuable long-term feature, but it is a different class of product from scheduling. It likely requires payroll integrations, payment rails, compliance review, employee disclosures, fee controls, and legal guidance.

The safer path is not to start by moving money directly. The first planning phase should be:

- Track earned tips and estimated earned wages accurately after shifts are worked.
- Separate estimated tips from verified/imported POS or payroll tip data.
- Build exportable records that payroll can reconcile.
- Research whether Shift Bay should integrate with an existing earned wage access provider rather than becoming one.
- Identify federal and state rules before designing fees.
- Design employee-facing disclosures and employer controls.
- Decide whether any fee is paid by the employee, subsidized by the employer, or charged as a platform service.

If pursued, the product should protect employees from accidentally draining their paycheck before payday. Advance limits, clear fee display, transaction history, and employer controls would be essential.

## Metrics To Start Tracking

- Minutes spent building each weekly schedule.
- Number of shifts in the bay at start.
- Number of shifts auto-added from templates.
- Number of manual changes after printing.
- Number of missed/flagged ROs.
- Number of warnings overridden.
- Number of floor plans printed.
- Number of manager edits after the schedule is drafted.
- Time spent entering schedule into Ctuit.

## Open Questions

- What is the first paid price point a restaurant would accept?
- Should the first paid version include employee self-service, or should that wait?
- How much setup customization is acceptable per restaurant?
- Should floor plan tools be part of the core product or a premium feature?
- How much of the Ctuit workflow can be automated safely?
- What agreement is needed before letting the current company use Shift Bay broadly?
- What name/logo protection is worth pursuing before public launch?
