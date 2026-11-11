"""Pydantic models for the internal engine contract (Section 7)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Point = list[float]


class ImageRef(BaseModel):
    path: str
    polygon: Optional[list[Point]] = None


class PairRef(BaseModel):
    before: ImageRef
    after: ImageRef


class RefCard(BaseModel):
    before: Optional[ImageRef] = None
    after: Optional[ImageRef] = None


class Required(BaseModel):
    change: Optional[float] = None
    stain: Optional[float] = None


class ModelSpec(BaseModel):
    path: str
    version: str


class ManualPoints(BaseModel):
    before: list[Point] = Field(default_factory=list)
    after: list[Point] = Field(default_factory=list)


class GradeOptions(BaseModel):
    stain_statistic: Literal["p90", "median"] = "p90"
    change_rule: Literal["area_weighted", "worst"] = "area_weighted"
    models: dict[str, Optional[ModelSpec]] = Field(default_factory=dict)
    manual_points: Optional[ManualPoints] = None


class GradeRequest(BaseModel):
    test_id: str
    fabric_type: Literal["PLAIN", "PRINTED"] = "PLAIN"
    adj_count: int = Field(2, ge=1, le=2)
    adj_fibres: list[str] = Field(default_factory=lambda: ["silk", "cotton"])
    required: Required = Field(default_factory=Required)
    pairs: dict[str, PairRef]
    ref_card: Optional[RefCard] = None
    options: GradeOptions = Field(default_factory=GradeOptions)


class InspectRequest(BaseModel):
    path: str
    expect_white: bool = False


class DetectRequest(BaseModel):
    path: str
    expected_pieces: list[Literal["SPECIMEN", "ADJ1", "ADJ2", "REF_CARD"]] = Field(default_factory=lambda: ["SPECIMEN"])


class RegisterRequest(BaseModel):
    before: ImageRef
    after: ImageRef
