# Reporting Context

The reporting context receives community-submitted game data and preserves or combines it according to
the meaning of each report.

## Language

**Report**:
A client submission describing observed game data or an occurrence.
_Avoid_: Report record

**Observation**:
A single accepted report retained independently rather than combined with prior reports.
_Avoid_: Append-only report, report record

**Current State**:
The most recently accepted value for a stable identity, replacing the previously known value.
_Avoid_: Aggregate

**Aggregate**:
A durable summary that combines repeated reports through defined accumulation rules.
_Avoid_: Current state, upsert record

**Definition**:
A deduplicated description of a known game concept.
_Avoid_: Aggregate

**Item-improvement Fact**:
A normalized claim about item-improvement availability, cost, or outcome, strengthened by repeated
supporting reports.
_Avoid_: Item-improvement record

**Domain Identity**:
The minimal stable values that determine whether two Reports describe the same Current State,
Aggregate, Definition, or Item-improvement Fact.
_Avoid_: Conflict key, database ID

**Dump Month**:
A Japan Standard Time calendar month used to group Observations for community publication and
retention.
_Avoid_: UTC month

**Community Dump**:
A verified monthly publication of Observations for community use.
_Avoid_: Database backup

**Data Epoch**:
A continuous period in which Current State, Aggregates, Definitions, and Item-improvement Facts share
one persistence history.
_Avoid_: Deployment, schema version
