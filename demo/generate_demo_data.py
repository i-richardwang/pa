# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb"]
# ///
"""生成 PA 公开演示数据：截止月相同时结果完全相同；截止月默认随当前日期推进；
各部门每月满足「上月人数 + 入职 − 离职 = 本月人数」。"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import random
import shutil
import uuid
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable, Sequence

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ID = "pa_demo"
GENERATOR_VERSION = "demo_v1"
SEED = 314159
HISTORY_MONTHS = 60
SIMULATION_START = date(2018, 1, 1)
Q12_ITEMS_PATH = Path(__file__).with_name("q12_items.json")


@dataclass(frozen=True)
class DepartmentSpec:
    code: str
    legal_entity_name: str
    organization_name: str
    department_name: str
    job_family_name: str
    title_root: str
    locations: tuple[str, ...]
    base_headcount: int
    annual_growth: float
    monthly_separation_rate: float
    fill_rate: float
    phase: int


@dataclass
class Employee:
    employee_id: str
    employee_name: str
    birth_date: date
    hire_date: date
    leave_date: date | None
    legal_entity_name: str
    organization_name: str
    department_id: str
    department_name: str
    work_location: str
    employment_type: str
    gender: str
    job_family_name: str
    job_title: str
    job_level_band: str
    fte: float
    engagement_trait: float


@dataclass(frozen=True)
class Q12Item:
    code: str
    title: str
    category: str


@dataclass(frozen=True)
class Q12Participant:
    employee: Employee
    responded: bool
    scores: tuple[int, ...]


@dataclass(frozen=True)
class Q12Wave:
    wave_id: str
    wave_name: str
    wave_month: date
    participants: tuple[Q12Participant, ...]


DEPARTMENTS = (
    DepartmentSpec(
        "product",
        "示例科技有限公司",
        "产品与技术事业部",
        "产品管理",
        "产品管理",
        "产品经理",
        ("上海", "深圳", "远程"),
        120,
        0.10,
        0.010,
        0.96,
        1,
    ),
    DepartmentSpec(
        "engineering",
        "示例科技有限公司",
        "产品与技术事业部",
        "工程研发",
        "软件工程",
        "软件工程师",
        ("上海", "深圳", "新加坡", "远程"),
        340,
        0.09,
        0.009,
        0.95,
        5,
    ),
    DepartmentSpec(
        "data",
        "示例科技有限公司",
        "产品与技术事业部",
        "数据分析",
        "数据与分析",
        "数据分析师",
        ("上海", "深圳", "远程"),
        80,
        0.14,
        0.011,
        0.93,
        9,
    ),
    DepartmentSpec(
        "design",
        "示例科技有限公司",
        "产品与技术事业部",
        "用户体验",
        "用户体验设计",
        "体验设计师",
        ("上海", "深圳", "远程"),
        65,
        0.07,
        0.010,
        0.97,
        13,
    ),
    DepartmentSpec(
        "sales",
        "示例服务有限公司",
        "客户解决方案事业部",
        "销售",
        "销售",
        "客户经理",
        ("上海", "深圳", "新加坡"),
        180,
        0.08,
        0.016,
        0.94,
        3,
    ),
    DepartmentSpec(
        "customer_success",
        "示例服务有限公司",
        "客户解决方案事业部",
        "客户成功",
        "客户成功",
        "客户成功顾问",
        ("上海", "深圳", "新加坡", "远程"),
        165,
        0.08,
        0.015,
        0.95,
        7,
    ),
    DepartmentSpec(
        "professional_services",
        "示例服务有限公司",
        "客户解决方案事业部",
        "专业服务",
        "专业服务",
        "实施顾问",
        ("上海", "深圳", "新加坡"),
        105,
        0.07,
        0.012,
        0.96,
        11,
    ),
    DepartmentSpec(
        "operations",
        "示例服务有限公司",
        "客户解决方案事业部",
        "运营",
        "业务运营",
        "运营专员",
        ("上海", "深圳"),
        130,
        0.04,
        0.013,
        0.98,
        15,
    ),
    DepartmentSpec(
        "finance",
        "示例科技有限公司",
        "企业职能中心",
        "财务",
        "财务",
        "财务专员",
        ("上海", "深圳"),
        55,
        0.04,
        0.007,
        1.00,
        2,
    ),
    DepartmentSpec(
        "people",
        "示例科技有限公司",
        "企业职能中心",
        "人力资源",
        "人力资源",
        "人力资源顾问",
        ("上海", "深圳", "远程"),
        55,
        0.05,
        0.009,
        0.98,
        6,
    ),
    DepartmentSpec(
        "legal",
        "示例科技有限公司",
        "企业职能中心",
        "法务合规",
        "法务与合规",
        "法务顾问",
        ("上海", "深圳"),
        30,
        0.03,
        0.006,
        1.00,
        10,
    ),
    DepartmentSpec(
        "it",
        "示例科技有限公司",
        "企业职能中心",
        "信息技术",
        "信息技术",
        "信息技术工程师",
        ("上海", "深圳", "远程"),
        55,
        0.05,
        0.008,
        0.98,
        14,
    ),
)

SURNAMES = (
    "陈",
    "林",
    "黄",
    "张",
    "李",
    "王",
    "吴",
    "刘",
    "周",
    "徐",
    "孙",
    "马",
    "朱",
    "胡",
    "郭",
    "何",
    "高",
    "罗",
    "郑",
    "梁",
)
GIVEN_NAMES = (
    "安然",
    "博文",
    "晨曦",
    "丹宁",
    "恩泽",
    "凡舒",
    "嘉禾",
    "景行",
    "可心",
    "乐言",
    "明远",
    "念初",
    "清和",
    "若溪",
    "思齐",
    "天佑",
    "文澜",
    "欣然",
    "一诺",
    "知夏",
    "子墨",
    "宇辰",
    "舒桐",
    "彦宁",
    "星遥",
    "语乔",
    "承宇",
    "瑾瑜",
    "书宁",
    "云舒",
)
LEVELS = ("初级", "中级", "高级", "专家", "管理")


def load_q12_items() -> tuple[Q12Item, ...]:
    raw = json.loads(Q12_ITEMS_PATH.read_text(encoding="utf-8"))
    items = tuple(Q12Item(**item) for item in raw)
    expected_codes = tuple(f"q{index:02d}" for index in range(1, 13))
    if tuple(item.code for item in items) != expected_codes:
        raise RuntimeError("Q12 题库必须按 q01 至 q12 完整声明")
    if any(not item.title or not item.category for item in items):
        raise RuntimeError("Q12 题库标题与类别不能为空")
    return items


Q12_ITEMS = load_q12_items()

COMMON_COLUMNS = (
    ("record_key", "VARCHAR"),
    ("employee_id", "VARCHAR"),
    ("employee_name", "VARCHAR"),
    ("year", "INTEGER"),
    ("month", "INTEGER"),
    ("period_month", "DATE"),
    ("record_date", "DATE"),
    ("legal_entity_name", "VARCHAR"),
    ("organization_name", "VARCHAR"),
    ("department_id", "VARCHAR"),
    ("department_name", "VARCHAR"),
    ("work_location", "VARCHAR"),
    ("employment_type", "VARCHAR"),
    ("gender", "VARCHAR"),
    ("age_band", "VARCHAR"),
    ("age", "INTEGER"),
    ("tenure_band", "VARCHAR"),
    ("tenure_years", "DOUBLE"),
    ("job_family_name", "VARCHAR"),
    ("job_title", "VARCHAR"),
    ("job_level_band", "VARCHAR"),
    ("fte", "DOUBLE"),
)

FACT_SCHEMAS = {
    "employee_month_snapshot_fact": COMMON_COLUMNS,
    "employee_hire_event_fact": COMMON_COLUMNS,
    "employee_leave_event_fact": COMMON_COLUMNS + (("leave_type", "VARCHAR"),),
    "workforce_month_exposure_fact": COMMON_COLUMNS + (("workforce_exposure", "DOUBLE"),),
    "q12_survey_participation_fact": COMMON_COLUMNS
    + (
        ("wave_id", "VARCHAR"),
        ("wave_name", "VARCHAR"),
        ("wave_month", "DATE"),
        ("responded_flag", "INTEGER"),
    ),
    "q12_survey_response_fact": COMMON_COLUMNS
    + (
        ("wave_id", "VARCHAR"),
        ("wave_name", "VARCHAR"),
        ("wave_month", "DATE"),
    )
    + tuple((f"{item.code}_score", "INTEGER") for item in Q12_ITEMS)
    + (
        ("q12_average_score", "DOUBLE"),
        ("q12_basic_needs_score", "DOUBLE"),
        ("q12_individual_contribution_score", "DOUBLE"),
        ("q12_teamwork_score", "DOUBLE"),
        ("q12_growth_score", "DOUBLE"),
        ("q12_answered_item_count", "INTEGER"),
        ("q12_favorable_item_count", "INTEGER"),
        ("q12_strongly_agree_item_count", "INTEGER"),
    ),
    "department_headcount_plan_fact": (
        ("record_key", "VARCHAR"),
        ("year", "INTEGER"),
        ("month", "INTEGER"),
        ("period_month", "DATE"),
        ("legal_entity_name", "VARCHAR"),
        ("organization_name", "VARCHAR"),
        ("department_id", "VARCHAR"),
        ("department_name", "VARCHAR"),
        ("planned_headcount", "INTEGER"),
    ),
}


def first_of_month(value: date) -> date:
    return value.replace(day=1)


def add_months(value: date, count: int) -> date:
    index = value.year * 12 + value.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def last_of_month(value: date) -> date:
    return value.replace(day=monthrange(value.year, value.month)[1])


def month_index(value: date) -> int:
    return (value.year - SIMULATION_START.year) * 12 + value.month - SIMULATION_START.month


def months(start: date, end: date) -> Iterable[date]:
    current = first_of_month(start)
    while current <= end:
        yield current
        current = add_months(current, 1)


def configured_anchor(today: date | None = None) -> date:
    configured = os.environ.get("PA_DEMO_AS_OF_MONTH")
    if configured:
        try:
            parsed = date.fromisoformat(f"{configured}-01")
        except ValueError as error:
            raise ValueError("PA_DEMO_AS_OF_MONTH 必须使用 YYYY-MM") from error
        if configured != parsed.strftime("%Y-%m"):
            raise ValueError("PA_DEMO_AS_OF_MONTH 必须使用 YYYY-MM")
        anchor = parsed
    else:
        anchor = add_months(first_of_month(today or date.today()), -1)
    if anchor < add_months(SIMULATION_START, HISTORY_MONTHS - 1):
        earliest = add_months(SIMULATION_START, HISTORY_MONTHS - 1)
        raise ValueError(f"截止月不能早于 {earliest:%Y-%m}，否则不足五年数据")
    return anchor


def output_root() -> Path:
    configured = os.environ.get("PA_SEMANTIC_DATA_DIR", "data/semantic_data")
    path = Path(configured)
    return path.resolve() if path.is_absolute() else (REPO_ROOT / path).resolve()


def publish_current(root: Path, version_dir: Path) -> None:
    current = root / "current"
    if current.exists() and not current.is_symlink():
        raise RuntimeError(f"{current} 必须是软链接：生成器通过替换软链接来切换数据版本")
    temporary = root / f".current-{uuid.uuid4().hex}"
    try:
        temporary.symlink_to(os.path.relpath(version_dir, root), target_is_directory=True)
        os.replace(temporary, current)
    finally:
        temporary.unlink(missing_ok=True)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def planned_headcount(spec: DepartmentSpec, period_month: date) -> int:
    elapsed = month_index(period_month)
    years = elapsed / 12
    growth = spec.base_headcount * (1 + spec.annual_growth * years)
    business_cycle = 1 + 0.035 * math.sin(2 * math.pi * (elapsed + spec.phase) / 48)
    seasonality = 1 + 0.012 * math.sin(2 * math.pi * (period_month.month + spec.phase) / 12)
    return max(12, round(growth * business_cycle * seasonality))


def desired_headcount(spec: DepartmentSpec, period_month: date) -> int:
    elapsed = month_index(period_month)
    fill = spec.fill_rate + 0.025 * math.sin(2 * math.pi * (elapsed + spec.phase) / 30)
    return round(planned_headcount(spec, period_month) * min(1.03, max(0.88, fill)))


def age_on(birth_date: date, on_date: date) -> int:
    return (
        on_date.year
        - birth_date.year
        - ((on_date.month, on_date.day) < (birth_date.month, birth_date.day))
    )


def age_band(age: int) -> str:
    if age < 25:
        return "25岁以下"
    if age < 35:
        return "25-34岁"
    if age < 45:
        return "35-44岁"
    if age < 55:
        return "45-54岁"
    return "55岁及以上"


def tenure_years(employee: Employee, on_date: date) -> float:
    return round(max(0, (on_date - employee.hire_date).days) / 365.2425, 2)


def tenure_band(years: float) -> str:
    if years < 1:
        return "1年以内"
    if years < 3:
        return "1-2年"
    if years < 5:
        return "3-4年"
    return "5年及以上"


def choose_level(rng: random.Random, initial: bool) -> str:
    threshold = rng.random()
    weights = (0.20, 0.36, 0.27, 0.10, 0.07) if initial else (0.34, 0.40, 0.19, 0.04, 0.03)
    cumulative = 0.0
    for level, weight in zip(LEVELS, weights, strict=True):
        cumulative += weight
        if threshold < cumulative:
            return level
    return LEVELS[-1]


def job_title(spec: DepartmentSpec, level: str) -> str:
    if level == "初级":
        return f"初级{spec.title_root}"
    if level == "高级":
        return f"高级{spec.title_root}"
    if level == "专家":
        return f"{spec.title_root}专家"
    if level == "管理":
        return f"{spec.department_name}经理"
    return spec.title_root


def create_employee(
    rng: random.Random, sequence: int, spec: DepartmentSpec, hire_date: date, *, initial: bool
) -> Employee:
    level = choose_level(rng, initial)
    level_age = {"初级": 23, "中级": 27, "高级": 32, "专家": 37, "管理": 35}[level]
    age_at_hire = min(53, level_age + rng.randrange(0, 9))
    birth_month = rng.randrange(1, 13)
    birth_day = rng.randrange(1, 29)
    employment_type = "兼职" if rng.random() < 0.06 else "全职"
    fte = rng.choice((0.6, 0.8)) if employment_type == "兼职" else 1.0
    gender_draw = rng.random()
    gender = "女性" if gender_draw < 0.48 else "男性" if gender_draw < 0.96 else "未披露"
    return Employee(
        employee_id=f"DEMO-{sequence:05d}",
        employee_name=f"{rng.choice(SURNAMES)}{rng.choice(GIVEN_NAMES)}",
        birth_date=date(hire_date.year - age_at_hire, birth_month, birth_day),
        hire_date=hire_date,
        leave_date=None,
        legal_entity_name=spec.legal_entity_name,
        organization_name=spec.organization_name,
        department_id=spec.code,
        department_name=spec.department_name,
        work_location=rng.choice(spec.locations),
        employment_type=employment_type,
        gender=gender,
        job_family_name=spec.job_family_name,
        job_title=job_title(spec, level),
        job_level_band=level,
        fte=fte,
        engagement_trait=rng.gauss(0, 1),
    )


def common_row(
    employee: Employee, record_key: str, period_month: date, record_date: date
) -> tuple[object, ...]:
    age = age_on(employee.birth_date, record_date)
    years = tenure_years(employee, record_date)
    return (
        record_key,
        employee.employee_id,
        employee.employee_name,
        period_month.year,
        period_month.month,
        period_month,
        record_date,
        employee.legal_entity_name,
        employee.organization_name,
        employee.department_id,
        employee.department_name,
        employee.work_location,
        employee.employment_type,
        employee.gender,
        age_band(age),
        age,
        tenure_band(years),
        years,
        employee.job_family_name,
        employee.job_title,
        employee.job_level_band,
        employee.fte,
    )


def separation_candidates(
    rng: random.Random, employees: Sequence[Employee], count: int, period_month: date
) -> list[Employee]:
    if count <= 0:
        return []

    def risk_score(employee: Employee) -> float:
        tenure = tenure_years(employee, period_month)
        tenure_factor = 1.35 if tenure < 1 else 1.0 if tenure < 5 else 0.78
        employment_factor = 1.12 if employee.employment_type == "兼职" else 1.0
        engagement_factor = min(1.4, max(0.68, 1 - 0.2 * employee.engagement_trait))
        return rng.random() * tenure_factor * employment_factor * engagement_factor

    return sorted(employees, key=risk_score, reverse=True)[: min(count, len(employees))]


def is_q12_wave(period_month: date) -> bool:
    survey_months = (2, 9) if period_month.year % 3 == 0 else (3, 9)
    return period_month.month in survey_months


def q12_score(rng: random.Random, employee: Employee, item_index: int, wave_month: date) -> int:
    spec = next(spec for spec in DEPARTMENTS if spec.department_name == employee.department_name)
    wave_cycle = 0.16 * math.sin(2 * math.pi * (month_index(wave_month) + spec.phase) / 32)
    workload = max(0, spec.monthly_separation_rate - 0.009) * 13
    item_offsets = (0.10, -0.02, 0.07, -0.16, 0.04, -0.08, -0.12, 0.13, 0.08, -0.05, -0.14, 0.02)
    common_noise = rng.gauss(0, 0.24)
    latent = (
        3.72
        + 0.3 * employee.engagement_trait
        + wave_cycle
        - workload
        + item_offsets[item_index]
        + common_noise
        + rng.gauss(0, 0.42)
    )
    return min(5, max(1, math.floor(latent + 0.5)))


def create_q12_wave(period_month: date, employees: Sequence[Employee]) -> Q12Wave:
    rng = random.Random(f"{SEED}:q12:{period_month:%Y-%m}")
    participants: list[Q12Participant] = []
    for employee in sorted(employees, key=lambda candidate: candidate.employee_id):
        years = tenure_years(employee, last_of_month(period_month))
        response_probability = 0.7
        response_probability += 0.035 if employee.employment_type == "全职" else -0.035
        response_probability += 0.025 if years >= 1 else -0.02
        response_probability += 0.018 * math.sin(
            2 * math.pi * (month_index(period_month) + len(employee.department_name)) / 18
        )
        responded = rng.random() < min(0.86, max(0.58, response_probability))
        scores = (
            tuple(q12_score(rng, employee, index, period_month) for index in range(len(Q12_ITEMS)))
            if responded
            else ()
        )
        participants.append(Q12Participant(employee, responded, scores))
    return Q12Wave(
        wave_id=f"q12_{period_month:%Y_%m}",
        wave_name=f"Q12 {period_month.year}年{period_month.month}月期",
        wave_month=period_month,
        participants=tuple(participants),
    )


def q12_response_summary(scores: Sequence[int]) -> tuple[object, ...]:
    def mean(values: Sequence[int]) -> float:
        return round(sum(values) / len(values), 4)

    return (
        mean(scores),
        mean(scores[0:2]),
        mean(scores[2:6]),
        mean(scores[6:10]),
        mean(scores[10:12]),
        len(scores),
        sum(score >= 4 for score in scores),
        sum(score == 5 for score in scores),
    )


def simulate(anchor: date) -> tuple[dict[str, list[tuple[object, ...]]], date]:
    rng = random.Random(SEED)
    history_start = add_months(anchor, -(HISTORY_MONTHS - 1))
    rows: dict[str, list[tuple[object, ...]]] = {name: [] for name in FACT_SCHEMAS}
    employees: list[Employee] = []
    next_sequence = 1
    first_wave_month = history_start
    while not is_q12_wave(first_wave_month):
        first_wave_month = add_months(first_wave_month, -1)
    initial_period = add_months(SIMULATION_START, -1)
    for spec in DEPARTMENTS:
        for _ in range(desired_headcount(spec, initial_period)):
            days_before = rng.randrange(30, 8 * 365)
            employees.append(
                create_employee(
                    rng,
                    next_sequence,
                    spec,
                    SIMULATION_START - timedelta(days=days_before),
                    initial=True,
                )
            )
            next_sequence += 1

    for period_month in months(SIMULATION_START, anchor):
        month_end = last_of_month(period_month)
        published = period_month >= history_start
        for spec in DEPARTMENTS:
            active = [
                employee
                for employee in employees
                if employee.department_name == spec.department_name and employee.leave_date is None
            ]
            seasonal_rate = spec.monthly_separation_rate * (
                1 + 0.22 * math.sin(2 * math.pi * (period_month.month + spec.phase) / 12)
            )
            organic_count = max(0, round(len(active) * seasonal_rate * rng.uniform(0.88, 1.12)))
            desired = desired_headcount(spec, period_month)
            reduction_count = max(0, len(active) - organic_count - desired)
            selected = separation_candidates(
                rng, active, organic_count + reduction_count, period_month
            )
            reduction_ids = (
                {employee.employee_id for employee in selected[-reduction_count:]}
                if reduction_count
                else set()
            )
            for employee in selected:
                employee.leave_date = period_month.replace(
                    day=rng.randrange(5, min(26, month_end.day + 1))
                )
                if employee.employee_id in reduction_ids:
                    leave_type = "被动离职"
                else:
                    draw = rng.random()
                    leave_type = (
                        "主动离职" if draw < 0.72 else "被动离职" if draw < 0.94 else "其他离职"
                    )
                if published:
                    rows["employee_leave_event_fact"].append(
                        common_row(
                            employee,
                            f"{employee.employee_id}:leave",
                            period_month,
                            employee.leave_date,
                        )
                        + (leave_type,)
                    )

            closing_before_hires = len(active) - len(selected)
            for _ in range(max(0, desired - closing_before_hires)):
                employee = create_employee(
                    rng,
                    next_sequence,
                    spec,
                    period_month.replace(day=rng.randrange(1, min(21, month_end.day + 1))),
                    initial=False,
                )
                employees.append(employee)
                next_sequence += 1
                if published:
                    rows["employee_hire_event_fact"].append(
                        common_row(
                            employee,
                            f"{employee.employee_id}:hire",
                            period_month,
                            employee.hire_date,
                        )
                    )

            if published:
                rows["department_headcount_plan_fact"].append(
                    (
                        f"{spec.code}:{period_month:%Y-%m}",
                        period_month.year,
                        period_month.month,
                        period_month,
                        spec.legal_entity_name,
                        spec.organization_name,
                        spec.code,
                        spec.department_name,
                        planned_headcount(spec, period_month),
                    )
                )

        if period_month >= first_wave_month and is_q12_wave(period_month):
            active_at_month_end = [
                employee
                for employee in employees
                if employee.hire_date <= month_end
                and (employee.leave_date is None or employee.leave_date > month_end)
            ]
            wave = create_q12_wave(period_month, active_at_month_end)
            for participant in wave.participants:
                employee = participant.employee
                state_key = f"{employee.employee_id}:{period_month:%Y-%m}:{wave.wave_id}"
                rows["q12_survey_participation_fact"].append(
                    common_row(employee, f"{state_key}:invite", period_month, month_end)
                    + (
                        wave.wave_id,
                        wave.wave_name,
                        wave.wave_month,
                        int(participant.responded),
                    )
                )
                if participant.responded:
                    rows["q12_survey_response_fact"].append(
                        common_row(employee, f"{state_key}:response", period_month, month_end)
                        + (
                            wave.wave_id,
                            wave.wave_name,
                            wave.wave_month,
                        )
                        + participant.scores
                        + q12_response_summary(participant.scores)
                    )
        if not published:
            continue
        for employee in employees:
            active_from = max(employee.hire_date, period_month)
            active_to = min(employee.leave_date or month_end, month_end)
            if active_from <= active_to:
                exposure = ((active_to - active_from).days + 1) / month_end.day
                rows["workforce_month_exposure_fact"].append(
                    common_row(
                        employee,
                        f"{employee.employee_id}:{period_month:%Y-%m}:exposure",
                        period_month,
                        active_to,
                    )
                    + (round(exposure, 8),)
                )
            if employee.hire_date <= month_end and (
                employee.leave_date is None or employee.leave_date > month_end
            ):
                rows["employee_month_snapshot_fact"].append(
                    common_row(
                        employee,
                        f"{employee.employee_id}:{period_month:%Y-%m}",
                        period_month,
                        month_end,
                    )
                )
    return rows, history_start


def write_fact(
    connection: duckdb.DuckDBPyConnection,
    staging: Path,
    name: str,
    schema: Sequence[tuple[str, str]],
    rows: Sequence[tuple[object, ...]],
) -> dict[str, object]:
    csv_path = staging / f".{name}.csv"
    parquet_path = staging / f"{name}.parquet"
    with csv_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow([column for column, _ in schema])
        writer.writerows(rows)
    projection = ", ".join(
        f'CAST("{column}" AS {data_type}) AS "{column}"' for column, data_type in schema
    )
    csv_literal = str(csv_path).replace("'", "''")
    parquet_literal = str(parquet_path).replace("'", "''")
    connection.execute(
        f"COPY (SELECT {projection} FROM read_csv('{csv_literal}', header=true, all_varchar=true)) "
        f"TO '{parquet_literal}' (FORMAT PARQUET)"
    )
    csv_path.unlink()
    result = connection.execute(
        "SELECT count(*), min(period_month), max(period_month) FROM read_parquet(?)",
        [str(parquet_path)],
    ).fetchone()
    return {
        "rows": result[0],
        "period_from": result[1].isoformat(),
        "period_to": result[2].isoformat(),
        "sha256": file_sha256(parquet_path),
    }


def validate(staging: Path, history_start: date, anchor: date) -> dict[str, object]:
    snapshot = staging / "employee_month_snapshot_fact.parquet"
    hires = staging / "employee_hire_event_fact.parquet"
    leaves = staging / "employee_leave_event_fact.parquet"
    exposure = staging / "workforce_month_exposure_fact.parquet"
    plans = staging / "department_headcount_plan_fact.parquet"
    survey_participation = staging / "q12_survey_participation_fact.parquet"
    survey_response = staging / "q12_survey_response_fact.parquet"
    with duckdb.connect() as connection:
        coverage = connection.execute(
            "SELECT count(DISTINCT period_month), min(period_month), max(period_month) FROM read_parquet(?)",
            [str(snapshot)],
        ).fetchone()
        if coverage != (HISTORY_MONTHS, history_start, anchor):
            raise RuntimeError(f"月末快照时间覆盖错误：{coverage}")
        plan_coverage = connection.execute(
            "SELECT count(*), count(DISTINCT period_month) FROM read_parquet(?)", [str(plans)]
        ).fetchone()
        if plan_coverage != (HISTORY_MONTHS * len(DEPARTMENTS), HISTORY_MONTHS):
            raise RuntimeError(f"编制计划时间覆盖错误：{plan_coverage}")
        survey_coverage = connection.execute(
            """
            SELECT count(DISTINCT period_month), min(period_month), max(period_month),
                   count(DISTINCT wave_id)
            FROM read_parquet(?)
            """,
            [str(survey_participation)],
        ).fetchone()
        if survey_coverage[0] != survey_coverage[3] or survey_coverage[2] > anchor:
            raise RuntimeError(f"Q12 期次数据的时间覆盖错误：{survey_coverage}")
        if not 9 <= survey_coverage[3] <= 11:
            raise RuntimeError(f"五年内的 Q12 期次应为 9 至 11 期，实际为 {survey_coverage[3]} 期")
        duplicate_keys = sum(
            connection.execute(
                "SELECT count(*) - count(DISTINCT record_key) FROM read_parquet(?)",
                [str(staging / f"{name}.parquet")],
            ).fetchone()[0]
            for name in FACT_SCHEMAS
        )
        if duplicate_keys:
            raise RuntimeError(f"record_key 重复的行数：{duplicate_keys}")
        invalid_exposure = connection.execute(
            "SELECT count(*) FROM read_parquet(?) WHERE workforce_exposure <= 0 OR workforce_exposure > 1",
            [str(exposure)],
        ).fetchone()[0]
        if invalid_exposure:
            raise RuntimeError(f"在职人月不在 (0, 1] 范围内的行数：{invalid_exposure}")
        balance_errors = connection.execute(
            """
            WITH closing AS (
              SELECT period_month, organization_name, department_name, count(*) AS headcount
              FROM read_parquet(?) GROUP BY ALL
            ), movement AS (
              SELECT period_month, organization_name, department_name, sum(hires) AS hires,
                     sum(separations) AS separations
              FROM (
                SELECT period_month, organization_name, department_name, count(*) AS hires, 0 AS separations
                FROM read_parquet(?) GROUP BY ALL
                UNION ALL
                SELECT period_month, organization_name, department_name, 0 AS hires, count(*) AS separations
                FROM read_parquet(?) GROUP BY ALL
              ) GROUP BY ALL
            ), reconciled AS (
              SELECT current.period_month, current.organization_name, current.department_name,
                     current.headcount, previous.headcount AS previous_headcount,
                     coalesce(movement.hires, 0) AS hires, coalesce(movement.separations, 0) AS separations
              FROM closing current
              LEFT JOIN closing previous
                ON previous.period_month = current.period_month - INTERVAL '1 month'
               AND previous.organization_name = current.organization_name
               AND previous.department_name = current.department_name
              LEFT JOIN movement
                ON movement.period_month = current.period_month
               AND movement.organization_name = current.organization_name
               AND movement.department_name = current.department_name
            )
            SELECT count(*) FROM reconciled
            WHERE previous_headcount IS NOT NULL
              AND headcount <> previous_headcount + hires - separations
            """,
            [str(snapshot), str(hires), str(leaves)],
        ).fetchone()[0]
        if balance_errors:
            raise RuntimeError(
                f"本月人数不等于上月人数 + 入职 − 离职的部门月份数：{balance_errors}"
            )
        invalid_leave_types = connection.execute(
            "SELECT count(*) FROM read_parquet(?) WHERE leave_type NOT IN ('主动离职', '被动离职', '其他离职')",
            [str(leaves)],
        ).fetchone()[0]
        if invalid_leave_types:
            raise RuntimeError(f"离职类型不是主动、被动或其他离职的行数：{invalid_leave_types}")
        invalid_survey = connection.execute(
            """
            SELECT count(*) FROM read_parquet(?)
            WHERE wave_month IS DISTINCT FROM period_month
               OR record_date IS DISTINCT FROM last_day(wave_month) OR responded_flag NOT IN (0, 1)
            """,
            [str(survey_participation)],
        ).fetchone()[0]
        score_bounds = " OR ".join(f"{item.code}_score NOT BETWEEN 1 AND 5" for item in Q12_ITEMS)
        invalid_responses = connection.execute(
            f"""
            SELECT count(*) FROM read_parquet(?)
            WHERE wave_month IS DISTINCT FROM period_month
               OR record_date IS DISTINCT FROM last_day(wave_month) OR q12_answered_item_count <> 12
               OR q12_favorable_item_count NOT BETWEEN 0 AND 12
               OR q12_strongly_agree_item_count NOT BETWEEN 0 AND q12_favorable_item_count
               OR {score_bounds}
            """,
            [str(survey_response)],
        ).fetchone()[0]
        score_sum = " + ".join(f"{item.code}_score" for item in Q12_ITEMS)
        favorable_sum = " + ".join(f"CAST({item.code}_score >= 4 AS INTEGER)" for item in Q12_ITEMS)
        strongly_agree_sum = " + ".join(
            f"CAST({item.code}_score = 5 AS INTEGER)" for item in Q12_ITEMS
        )
        response_summary_errors = connection.execute(
            f"""
            SELECT count(*) FROM read_parquet(?)
            WHERE abs(q12_average_score - ({score_sum}) / 12.0) > 0.0001
               OR abs(q12_basic_needs_score - (q01_score + q02_score) / 2.0) > 0.0001
               OR abs(q12_individual_contribution_score
                      - (q03_score + q04_score + q05_score + q06_score) / 4.0) > 0.0001
               OR abs(q12_teamwork_score
                      - (q07_score + q08_score + q09_score + q10_score) / 4.0) > 0.0001
               OR abs(q12_growth_score - (q11_score + q12_score) / 2.0) > 0.0001
               OR q12_favorable_item_count <> {favorable_sum}
               OR q12_strongly_agree_item_count <> {strongly_agree_sum}
            """,
            [str(survey_response)],
        ).fetchone()[0]
        wave_cohort_errors = connection.execute(
            """
            WITH invited AS (
              SELECT wave_month, count(*) AS invited
              FROM read_parquet(?) GROUP BY ALL
            ), active AS (
              SELECT period_month AS wave_month, count(*) AS active
              FROM read_parquet(?) GROUP BY ALL
            )
            SELECT count(*) FROM invited JOIN active USING (wave_month)
            WHERE invited <> active
            """,
            [str(survey_participation), str(snapshot)],
        ).fetchone()[0]
        survey_balance_errors = connection.execute(
            """
            WITH participation AS (
              SELECT period_month, wave_id, sum(responded_flag) AS respondents
              FROM read_parquet(?) GROUP BY ALL
            ), responses AS (
              SELECT period_month, wave_id, count(*) AS respondents
              FROM read_parquet(?) GROUP BY ALL
            )
            SELECT count(*) FROM participation
            FULL JOIN responses USING (period_month, wave_id)
            WHERE coalesce(participation.respondents, 0) <> coalesce(responses.respondents, 0)
            """,
            [str(survey_participation), str(survey_response)],
        ).fetchone()[0]
        if (
            invalid_survey
            or invalid_responses
            or response_summary_errors
            or wave_cohort_errors
            or survey_balance_errors
        ):
            raise RuntimeError(
                "Q12 数据校验失败（各项为不符合规则的行数）："
                f"participation={invalid_survey}, responses={invalid_responses}, "
                f"summary={response_summary_errors}, cohort={wave_cohort_errors}, "
                f"balance={survey_balance_errors}"
            )
        current_headcount = connection.execute(
            "SELECT count(*) FROM read_parquet(?) WHERE period_month = ?", [str(snapshot), anchor]
        ).fetchone()[0]
        if not 1800 <= current_headcount <= 3200:
            raise RuntimeError(f"截止月在职人数应在 1800 至 3200 之间，实际为 {current_headcount}")
        current_survey = connection.execute(
            """
            SELECT count(*), sum(responded_flag), min(wave_id), max(wave_id)
            FROM read_parquet(?) WHERE period_month = ?
            """,
            [str(survey_participation), survey_coverage[2]],
        ).fetchone()
        current_response_rate = current_survey[1] / current_survey[0]
        if not 0.58 <= current_response_rate <= 0.86 or current_survey[2] != current_survey[3]:
            raise RuntimeError(
                f"最近一次 Q12 投放的月份应只有一期且回复率在 58% 至 86% 之间，实际为：{current_survey}"
            )
    return {
        "month_coverage": HISTORY_MONTHS,
        "department_balance": "passed",
        "unique_record_keys": "passed",
        "current_headcount": current_headcount,
        "q12_wave_count": survey_coverage[3],
        "q12_current_response_rate": round(current_response_rate, 4),
        "q12_consistency": "passed",
    }


def main() -> None:
    anchor = configured_anchor()
    root = output_root()
    versions = root / "versions"
    staging = root / f".demo-staging-{uuid.uuid4().hex}"
    root.mkdir(parents=True, exist_ok=True)
    versions.mkdir(parents=True, exist_ok=True)
    staging.mkdir()
    connection = duckdb.connect()
    try:
        facts, history_start = simulate(anchor)
        files = {
            f"{name}.parquet": write_fact(connection, staging, name, schema, facts[name])
            for name, schema in FACT_SCHEMAS.items()
        }
        validation = validate(staging, history_start, anchor)
        content_fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "generator_version": GENERATOR_VERSION,
                    "seed": SEED,
                    "as_of_month": anchor.strftime("%Y-%m"),
                    "files": files,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        version = f"{GENERATOR_VERSION}_{anchor:%Y_%m}_{content_fingerprint[:12]}"
        target = versions / version
        manifest: dict[str, object] = {
            "semantic_package": PACKAGE_ID,
            "version": version,
            "generator_version": GENERATOR_VERSION,
            "seed": SEED,
            "synthetic": True,
            "as_of_month": anchor.strftime("%Y-%m"),
            "history_from": history_start.strftime("%Y-%m"),
            "history_to": anchor.strftime("%Y-%m"),
            "content_fingerprint": content_fingerprint,
            "files": files,
            "validation": validation,
        }
        manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        (staging / "manifest.json").write_text(manifest_text, encoding="utf-8")
        if target.exists():
            existing_manifest = target / "manifest.json"
            intact_files = all(
                (target / filename).is_file()
                and file_sha256(target / filename) == metadata["sha256"]
                for filename, metadata in files.items()
            )
            if (
                not existing_manifest.is_file()
                or existing_manifest.read_text(encoding="utf-8") != manifest_text
                or not intact_files
            ):
                raise RuntimeError(
                    f"同一内容的版本目录已存在，但文件缺失或与本次生成结果不一致：{target}"
                )
        else:
            os.replace(staging, target)
        publish_current(root, target)
    finally:
        connection.close()
        if staging.exists():
            shutil.rmtree(staging)
    print(f"demo semantic data: {target} -> {root / 'current'}")


if __name__ == "__main__":
    main()
