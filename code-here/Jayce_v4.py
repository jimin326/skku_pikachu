# ════════════════════════════════════════════════════════════════════
#  Jayce_v4 — 2026 SKKU × HYU CSE 교류전 AI 부문 (Python 포팅판)
# ════════════════════════════════════════════════════════════════════
#
# ■ 이 파일이 하는 일 (처음 보는 사람을 위한 안내)
#
#   피카츄 배구 봇입니다. 게임 엔진이 매 틱(3프레임 = 120ms)마다
#   decide(snapshot)을 호출하고, 이 함수는 그 순간의 게임 상황(dict)을
#   보고 조작 {'x', 'y', 'hit'}를 돌려줍니다.
#
#     x   ∈ {-1, 0, 1} : 좌 / 정지 / 우 이동
#     y   ∈ {-1, 0, 1} : 위(지상에서는 점프) / 정지 / 아래
#     hit ∈ {0, 1}     : 파워히트(스파이크) 버튼
#
#   Jayce_v4.js의 1:1 포팅입니다 — 로직·상수·점수 체계가 전부 동일하며,
#   동일 스냅샷 시퀀스에 동일 액션을 내는 것을 차등 테스트로 검증했습니다.
#   각 부분의 상세한 설계 설명은 JS판의 주석을 참고하세요. 이 파일의
#   주석은 핵심 요약 + Python 특이사항 위주입니다.
#
# ■ 좌표계 (중요 — 직관과 다름)
#
#   원점은 화면 좌상단. x는 오른쪽으로 증가(0~432, 네트 216),
#   y는 "아래로" 증가 — 바닥에 선 캐릭터가 y=244, 점프하면 y가 작아짐.
#   공이 떨어지는 중 = yVelocity > 0.
#
# ■ 전체 구조 (decide가 매 틱 하는 일)
#
#   decide(s)
#    └ decide_core(s)               ← 실제 판단 (예외 시 fallback_action)
#       ├ update_touches(s)         ← 우리 편 연속 터치 수 추정 (5회 실점 룰)
#       ├ [다이빙/기상 중] → 중립
#       ├ [공중] choose_air_policy  ← 조작 후보 12개를 시뮬해 결과가 가장
#       │                             좋은 것 선택 (한 번 고르면 유지=커밋)
#       ├ [지상, 상대 공] defense_target ← 상대의 전 코스 착지점을 시뮬해
#       │                             최악 코스 커버가 최선인 위치로 이동
#       └ [지상, 우리 공]
#           ├ find_kill_jump        ← 상대가 절대 못 받는 코스가 성립하면
#           │                          즉시 점프 (벽뚫기·급락)
#           ├ find_intercept        ← 일반 요격 점프 타이밍 판단
#           ├ (리시브) 공을 네트 앞 상공으로 띄우는 셋업 패스
#           └ (다이빙) 걸어서 못 닿는 공 세이브
#
# ■ 핵심 아이디어
#
#   게임 엔진의 물리를 그대로 복제한 시뮬레이터(step_ball, micro_sim,
#   micro_sim_seq)로 "이 조작을 하면 공이 어디 떨어지고 상대가 받을 수
#   있는가"를 실제로 굴려보고 최선을 고릅니다. opp_window(히트 후 상대가
#   도달 가능했던 프레임 수)가 0이면 어떤 무빙으로도 못 받는 확정 킬.
#
# ■ Python 특이사항 (JS판과의 차이는 문법뿐)
#
#   - 스냅샷은 dict: s['ball']['x'] 처럼 접근 (필드명은 JS와 동일)
#   - JS의 (v / 3) | 0  (소수 버림)   → 양수 전용이므로 // 3 으로 동일
#   - JS의 Math.round (반올림 half-up) → js_round 헬퍼 (Python 내장
#     round는 은행가 반올림이라 결과가 달라질 수 있어 사용 금지)
#   - 표준 라이브러리 math만 사용 (대회 규정 내)

import math

# ── 엔진 상수 — 게임 엔진(physics.js)의 값 그대로. 수정 금지 ─────────
GROUND_WIDTH = 432      # 코트 전체 폭 (x: 0 ~ 432)
NET_X = 216             # 네트 x 좌표
PLAYER_GROUND_Y = 244   # 캐릭터가 땅에 서 있을 때의 y
BALL_GROUND_Y = 252     # 공이 땅에 닿는 y
PLAYER_HALF = 32        # 히트박스 반폭·반높이 (충돌 판정 ±32)
NET_HALF_W = 25         # 네트 기둥 반폭 (x = 216 ± 25)
NET_TOP_Y = 176         # 네트 상단 밴드 위쪽 y
NET_TOP_BOTTOM_Y = 192  # 네트 상단 밴드 아래쪽 y
WALK_SPEED = 6          # 걷기 (px/프레임)
DIVE_SPEED = 8          # 다이빙 (px/프레임)
LATENCY_FRAMES = 1      # 스냅샷 t의 결정은 프레임 t+1부터 적용 (실측)

# 튜닝 파라미터 — 오프라인 스윕 + 상호 토너먼트로 결정 (find_intercept용)
CFG = {
    'AIR_MIN': 3,   # 요격 접촉의 최소 점프 나이
    'AIR_MAX': 16,  # 최대 점프 나이 (16 = 정점)
    'Y_LO': 120,    # 요격 높이 밴드 상단
    'Y_HI': 218,    # 하단
    'TOL': 26,      # 접촉 y 허용 오차
    'BAND': 0,      # 상대 소유 시 중앙 대기 밴드 (0 = 미사용)
    'ARM_J': 8,     # (구버전 잔재 — 현재 미사용)
}

# ── 틱 사이에 유지되는 전역 상태 (봇 실행 모델: 전역은 틱 간 유지) ───
g_prev = None                             # 직전 스냅샷 요약
g_touches = 0                             # 이번 소유 동안 우리 터치 수 추정
g_prev_ball_on_left = None                # 직전 틱 공의 하프 (터치 리셋용)
g_prev_tick = None                        # 직전 tick
g_last_action = {'x': 0, 'y': 0, 'hit': 0}  # 직전에 낸 조작 (지연 보정용)
g_air_policy = None                       # 공중 커밋 정책 (착지 시 해제)
g_group = 3  # 틱당 프레임 수 — 매 틱 s['config']에서 갱신
#            (공식 가이드: "조정될 수 있으니 하드코딩하지 말 것")


def clamp(v, lo, hi):
    """v를 [lo, hi] 범위로 자른다."""
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def js_round(v):
    """JS Math.round와 동일한 half-up 반올림 (양수 인자 전용으로 사용)."""
    return math.floor(v + 0.5)


# ── 공 1프레임 시뮬 — 엔진 physics.js의 월드 충돌 처리를 그대로 복제 ─
def step_ball(b):
    """b({'x','y','xV','yV'})를 직접 수정하며 1프레임 진행.

    벽 반사, 천장, 네트 상단/측면 반사, 중력, 착지를 전부 처리한다.
    반환값 True = 이 프레임에 착지 (b['x']가 착지점).
    """
    # 좌우 벽: 공 중심이 화면 밖으로 나가려 하면 x속도 반전
    fx = b['x'] + b['xV']
    if fx < 0 or fx > GROUND_WIDTH:
        b['xV'] = -b['xV']
    # 천장: 위로 뚫으려 하면 y속도를 1(아래)로 리셋
    if b['y'] + b['yV'] < 0:
        b['yV'] = 1
    # 네트 기둥 영역 (x가 216±25, y가 176보다 아래)
    if abs(b['x'] - NET_X) < NET_HALF_W and b['y'] > NET_TOP_Y:
        if b['y'] <= NET_TOP_BOTTOM_Y:
            # 네트 윗면(176~192): 내려오는 공이면 위로 튕김
            if b['yV'] > 0:
                b['yV'] = -b['yV']
        elif b['x'] < NET_X:
            b['xV'] = -abs(b['xV'])  # 왼쪽 측면: 왼쪽으로 밀어냄
        else:
            b['xV'] = abs(b['xV'])   # 오른쪽 측면: 오른쪽으로
    fy = b['y'] + b['yV']
    if fy > BALL_GROUND_Y:
        return True  # 착지!
    b['y'] = fy
    b['x'] += b['xV']
    b['yV'] += 1  # 중력
    return False


def clone_ball(ball):
    """스냅샷 공(xVelocity 표기)을 시뮬용 {'x','y','xV','yV'}로 복사."""
    return {'x': ball['x'], 'y': ball['y'],
            'xV': ball['xVelocity'], 'yV': ball['yVelocity']}


def ball_after(ball, n):
    """공의 n프레임 뒤 상태 (착지하면 그 시점에서 멈춤)."""
    b = clone_ball(ball)
    for _ in range(n):
        if step_ball(b):
            break
    return b


def frames_to_landing(ball):
    """공이 땅에 닿기까지 남은 프레임 수 (상한 200)."""
    b = clone_ball(ball)
    for i in range(1, 201):
        if step_ball(b):
            return i
    return 200


def power_hit_landing(b0, x_abs, yd):
    """지금 이 공(b0)을 파워히트하면 어디에 떨어지나.

    엔진 공식: xV = ±(|x입력|+1)*10 (상대 쪽), yV = max(15,|yV|)*y입력*2.
    ※ 엔진은 파워히트 "이전에" 일반 바운스로 |yV|를 최소 15로 올린다 —
      이 바닥값을 빼먹으면 착지 예측이 크게 틀린다 (실측 버그였음).
    반환: {'x': 착지점, 'frames': 착지까지 프레임 수}
    """
    b = {
        'x': b0['x'],
        'y': b0['y'],
        'xV': (1 if b0['x'] < NET_X else -1) * (x_abs + 1) * 10,
        'yV': max(15, abs(b0['yV'])) * yd * 2,
    }
    for i in range(1, 201):
        if step_ball(b):
            return {'x': b['x'], 'frames': i}
    return {'x': b['x'], 'frames': 200}


# ── 상대 요격 가능성 판정 — "통과탄" 인식의 핵심 ─────────────────────
def opp_can_reach(b, opp_x, opp_min_x, opp_max_x, f_since_hit):
    """히트 후 f프레임 시점에 상대가 공 b에 닿을 수 있는가.

    조건: 상대 코트 범위(±32) 안 + 점프 최고 리치(y=76) 이상 +
    지상 리치(y≥212)보다 높으면 점프 준비 5프레임 필요 + 걷기로 도달
    가능한 거리. 매 프레임 이 검사에 걸린 횟수(opp_window)가 0이면
    어떤 무빙·점프로도 못 받는 확정 킬 코스다. (프레임당 65px+로
    움직이는 공이 히트박스를 "프레임 사이로" 통과하는 것도 잡힌다)
    """
    if b['x'] < opp_min_x - PLAYER_HALF or b['x'] > opp_max_x + PLAYER_HALF:
        return False
    if b['y'] < 76:
        return False
    if b['y'] < 212 and f_since_hit < 5:
        return False  # 점프로만 닿는 높이 — 준비 시간 필요
    return abs(b['x'] - opp_x) <= WALK_SPEED * f_since_hit + 40


# ── 공중 마이크로 시뮬레이터 — 이 봇의 두뇌 ──────────────────────────
def micro_sim(me0, ball0, first_action, action, min_x, max_x, max_frames,
              opp_info=None):
    """내 몸과 공을 엔진과 동일한 프레임 순서로 함께 시뮬레이션.

    순서: ① 공 이동·반사 ② 내 이동·상태전이 ③ 충돌(엣지 트리거 —
    겹침의 시작 순간에만 1회, state 2면 파워히트 아니면 몸 범프).
    조작을 상수로 유지한 채 굴리므로 네트 반사 후 재타격(더블히트 가속)
    같은 연쇄도 정확히 재현된다.

    me0: {'x','y','vy','state'(1|2),'delay','frameNo','collFlag'}
    first_action: 1프레임째 조작(=직전 틱 조작, 지연 반영)
    action: 2프레임째부터 유지되는 평가 대상 조작
    반환: {'landed','landX','frames','touches','powerTouches',
           'oppWindow'(히트 후 상대가 닿을 수 있던 프레임 수)}
    """
    mx = me0['x']
    my = me0['y']
    vy = me0['vy']
    state = me0['state']
    delay = me0['delay']
    frame_no = me0['frameNo']
    b = {'x': ball0['x'], 'y': ball0['y'],
         'xV': ball0['xVelocity'], 'yV': ball0['yVelocity']}
    coll_flag = me0.get('collFlag', False) is True
    touches = 0
    power_touches = 0
    opp_window = 0
    f_since_hit = -1  # -1 = 아직 파워히트 없음

    for f in range(1, max_frames + 1):
        a = first_action if f == 1 else action

        # ① 공 월드 이동 (착지 시 결과 반환)
        if step_ball(b):
            return {'landed': True, 'landX': b['x'], 'frames': f,
                    'touches': touches, 'powerTouches': power_touches,
                    'oppWindow': opp_window}
        # 히트 이후라면 상대 요격 가능 프레임 누적
        if f_since_hit >= 0:
            f_since_hit += 1
            if opp_info is not None and opp_can_reach(
                    b, opp_info['x'], opp_info['minX'], opp_info['maxX'],
                    f_since_hit):
                opp_window += 1

        # ② 내 이동·상태전이 (엔진 순서 축약 — 공중 전용)
        if state < 3:
            mx = clamp(mx + a['x'] * WALK_SPEED, min_x, max_x)
        future_y = my + vy
        my = future_y
        if future_y < PLAYER_GROUND_Y:
            vy += 1  # 공중: 중력
        else:
            my = PLAYER_GROUND_Y  # 착지 — 이후 공은 자유 비행
            vy = 0
            state = 0
        # 히트 버튼: 점프 중(state 1)이면 파워히트 모션(state 2) 개시
        if a['hit'] == 1 and state == 1:
            delay = 5
            frame_no = 0
            state = 2
        # state 2 모션 진행 (~10프레임 지속 후 state 1 복귀)
        if state == 2:
            if delay < 1:
                frame_no += 1
                if frame_no > 4:
                    frame_no = 0
                    state = 1
            else:
                delay -= 1

        # ③ 충돌 판정 (±32 AABB, 겹침 시작 순간만)
        overlap = abs(b['x'] - mx) <= PLAYER_HALF and abs(b['y'] - my) <= PLAYER_HALF
        if overlap:
            if not coll_flag:
                # 몸 범프: 몸 중심 반대쪽으로 (거리//3)의 속도
                if b['x'] < mx:
                    b['xV'] = -(abs(b['x'] - mx) // 3)
                elif b['x'] > mx:
                    b['xV'] = abs(b['x'] - mx) // 3
                # (정중앙 xV==0이면 엔진은 랜덤 ±1 — 결정적 근사로 0 유지)
                abs_y = abs(b['yV'])
                b['yV'] = -15 if abs_y < 15 else -abs_y  # 위로, 최소 15
                if state == 2:
                    # 파워히트! 접촉 "순간"의 조작이 코스를 결정
                    b['xV'] = (1 if b['x'] < NET_X else -1) * (abs(a['x']) + 1) * 10
                    b['yV'] = abs(b['yV']) * a['y'] * 2
                    power_touches += 1
                    opp_window = 0  # 새 히트 기준으로 요격 창 재계산
                    f_since_hit = 0
                touches += 1
                coll_flag = True
        else:
            coll_flag = False

    return {'landed': False, 'landX': b['x'], 'frames': max_frames,
            'touches': touches, 'powerTouches': power_touches,
            'oppWindow': opp_window}


# ── 시퀀스 시뮬 — 킬 점프 평가 전용 ─────────────────────────────────
def micro_sim_seq(me0, ball0, stages, min_x, max_x, max_frames, opp_info=None):
    """micro_sim + (i) 지상 점프 개시 (ii) 프레임 구간별 조작 스케줄
    (iii) 마지막 파워히트 프레임 기록(lastHitFrame).

    stages: [{'until': 마지막 적용 프레임(포함), 'act': 조작}, ...]
    예: [1프레임=직전 조작, 2~4프레임=점프, 이후=스매시 조준]의 3단 계획.
    """
    mx = me0['x']
    my = me0['y']
    vy = me0['vy']
    state = me0['state']
    delay = me0['delay']
    frame_no = me0['frameNo']
    b = {'x': ball0['x'], 'y': ball0['y'],
         'xV': ball0['xVelocity'], 'yV': ball0['yVelocity']}
    coll_flag = me0.get('collFlag', False) is True
    touches = 0
    power_touches = 0
    opp_window = 0
    f_since_hit = -1
    last_hit_frame = 0
    si = 0  # 현재 stage 인덱스

    for f in range(1, max_frames + 1):
        # 이번 프레임에 해당하는 조작을 스케줄에서 찾는다
        while si < len(stages) - 1 and f > stages[si]['until']:
            si += 1
        a = stages[si]['act']

        # ① 공 이동 (micro_sim과 동일)
        if step_ball(b):
            return {'landed': True, 'landX': b['x'], 'frames': f,
                    'touches': touches, 'powerTouches': power_touches,
                    'lastHitFrame': last_hit_frame, 'oppWindow': opp_window}
        if f_since_hit >= 0:
            f_since_hit += 1
            if opp_info is not None and opp_can_reach(
                    b, opp_info['x'], opp_info['minX'], opp_info['maxX'],
                    f_since_hit):
                opp_window += 1

        # ② 내 이동·상태전이 — 엔진 순서 그대로:
        #    x이동 → 점프 개시 → 중력·착지 → 히트 장전 → 모션 진행
        if state < 3:
            mx = clamp(mx + a['x'] * WALK_SPEED, min_x, max_x)
        # 지상 점프 개시 (micro_sim과의 유일한 물리 차이)
        if state < 3 and a['y'] == -1 and my == PLAYER_GROUND_Y:
            vy = -16
            state = 1
        future_y = my + vy
        my = future_y
        if future_y < PLAYER_GROUND_Y:
            vy += 1
        else:
            my = PLAYER_GROUND_Y
            vy = 0
            if state == 1 or state == 2:
                state = 0
        if a['hit'] == 1 and state == 1:
            delay = 5
            frame_no = 0
            state = 2
        if state == 2:
            if delay < 1:
                frame_no += 1
                if frame_no > 4:
                    frame_no = 0
                    state = 1
            else:
                delay -= 1

        # ③ 충돌 (micro_sim과 동일)
        overlap = abs(b['x'] - mx) <= PLAYER_HALF and abs(b['y'] - my) <= PLAYER_HALF
        if overlap:
            if not coll_flag:
                if b['x'] < mx:
                    b['xV'] = -(abs(b['x'] - mx) // 3)
                elif b['x'] > mx:
                    b['xV'] = abs(b['x'] - mx) // 3
                abs_y = abs(b['yV'])
                b['yV'] = -15 if abs_y < 15 else -abs_y
                if state == 2:
                    b['xV'] = (1 if b['x'] < NET_X else -1) * (abs(a['x']) + 1) * 10
                    b['yV'] = abs(b['yV']) * a['y'] * 2
                    power_touches += 1
                    last_hit_frame = f
                    opp_window = 0
                    f_since_hit = 0
                touches += 1
                coll_flag = True
        else:
            coll_flag = False

    return {'landed': False, 'landX': b['x'], 'frames': max_frames,
            'touches': touches, 'powerTouches': power_touches,
            'lastHitFrame': last_hit_frame, 'oppWindow': opp_window}


# ── 킬 점프 탐색 — "지금 점프하면 못 받는 스파이크가 성립하는가?" ────
def find_kill_jump(s, min_x, max_x):
    """지상에서 매 틱 호출. 점프 방향 3 × 스매시 조준 9 = 27개 계획을
    시퀀스 시뮬로 굴려, 파워히트 성사 + 상대 코트 착지 + "킬"(히트 후
    14프레임 내 착지 / 걸어서 못 닿음 / 요격 창 0 = 통과탄)이면 즉시
    점프. 반환: {'jx': 점프 중 이동, 'smash': 유지할 조준, 'score'} 또는
    None. (기하 조건이 안 맞아도 킬각이면 뛴다 — "네트 앞에서 공 들고만
    있다가 기회를 흘리는" 문제를 해결한 v3의 핵심 추가)
    """
    is_right = s['side'] == 'RIGHT'
    opp_min_x = 0 if is_right else NET_X
    opp_max_x = NET_X if is_right else GROUND_WIDTH
    budget = 4 - g_touches  # 남은 안전 터치 (5번째 접촉 = 실점)
    if budget < 1:
        return None
    first = {'x': g_last_action['x'], 'y': g_last_action['y'],
             'hit': g_last_action['hit']}
    me0 = {  # 시뮬 시작: 지금 지상에 서 있는 나
        'x': s['self']['x'],
        'y': s['self']['y'],
        'vy': 0,
        'state': 0,
        'delay': 0,
        'frameNo': 0,
        'collFlag': (abs(s['ball']['x'] - s['self']['x']) <= PLAYER_HALF
                     and abs(s['ball']['y'] - s['self']['y']) <= PLAYER_HALF),
    }
    best = None
    for jx in (0, 1, -1):          # 점프하며 이동할 방향
        jump_act = {'x': jx, 'y': -1, 'hit': 0}  # y=-1 = 점프 입력
        for cx in (0, 1, -1):      # 공중 이동(=히트 속도에도 영향)
            for yd in (1, 0, -1):  # 스매시 각도
                smash = {'x': cx, 'y': yd, 'hit': 1}
                r = micro_sim_seq(
                    me0, s['ball'],
                    [
                        {'until': 1, 'act': first},     # 1f: 지연 프레임
                        {'until': 4, 'act': jump_act},  # 2~4f: 점프 틱
                        {'until': 999, 'act': smash},   # 이후: 조준 유지
                    ],
                    min_x, max_x, 44,
                    {
                        'x': s['opp']['x'],
                        'minX': (PLAYER_HALF if is_right
                                 else NET_X + PLAYER_HALF),
                        'maxX': (NET_X - PLAYER_HALF if is_right
                                 else GROUND_WIDTH - PLAYER_HALF),
                    })
                if not r['landed'] or r['powerTouches'] < 1:
                    continue  # 히트 불발
                if r['touches'] > budget:
                    continue  # 터치 한도 초과
                if r['landX'] <= opp_min_x + 4 or r['landX'] >= opp_max_x - 4:
                    continue  # 상대 코트 아님
                drop = r['frames'] - r['lastHitFrame']  # 히트 후 낙하 시간
                dist_from_opp = abs(r['landX'] - s['opp']['x'])
                unreachable = dist_from_opp > WALK_SPEED * drop + 44
                through_ball = r['oppWindow'] == 0  # 통과탄 확정 킬
                if drop > 14 and not unreachable and not through_ball:
                    continue  # 킬각 아님
                # 빠를수록·상대에서 멀수록 좋음. 통과탄 최우선
                score = 300 - drop * 6 + dist_from_opp
                if through_ball:
                    score += 250
                elif unreachable:
                    score += 120
                if best is None or score > best['score']:
                    best = {'jx': jx, 'smash': smash, 'score': score}
    return best


# ── 공중 조작 정책 하나의 점수 평가 ─────────────────────────────────
def score_air_action(s, me0, first, act, min_x, max_x):
    """조작 act를 유지했을 때의 결과를 micro_sim으로 굴려 점수화.

    상대 코트 착지+내 접촉: 코스 품질 점수 (요격 창 0 = +250 확정 킬,
    ≤2 = +120, 거리상 못 닿음 +120, 더블히트 +60, 약한 반환 -120).
    내 코트 착지+범프: -80 (공격권 유지). 자책성: -500대.
    반환: 점수 또는 None(공에 관여 불가/터치 한도 초과).
    """
    is_right = s['side'] == 'RIGHT'
    opp_min_x = 0 if is_right else NET_X
    opp_max_x = NET_X if is_right else GROUND_WIDTH
    touch_budget = 4 - g_touches  # 5번째 접촉은 실점
    opp_info = {
        'x': s['opp']['x'],
        'minX': PLAYER_HALF if opp_min_x == 0 else NET_X + PLAYER_HALF,
        'maxX': (NET_X - PLAYER_HALF if opp_max_x == NET_X
                 else GROUND_WIDTH - PLAYER_HALF),
    }
    r = micro_sim(me0, s['ball'], first, act, min_x, max_x, 34, opp_info)
    if not r['landed']:
        return None
    if r['touches'] > touch_budget:
        return None  # 터치 제한 위반
    on_opp = opp_min_x + 4 < r['landX'] < opp_max_x - 4
    if on_opp and r['touches'] > 0:
        dist_from_opp = abs(r['landX'] - s['opp']['x'])
        score = dist_from_opp - r['frames'] * 2  # 멀고 빠를수록 좋음
        # 요격 창 기반 킬 판정 (통과탄·즉착탄은 거리와 무관한 확정 킬)
        if r['powerTouches'] > 0 and r['oppWindow'] == 0:
            score += 250
        elif r['powerTouches'] > 0 and r['oppWindow'] <= 2:
            score += 120
        elif dist_from_opp > WALK_SPEED * r['frames'] + 44:
            score += 120
        if r['powerTouches'] >= 2:
            score += 60  # 더블히트(썬더) 가속 코스
        if act['hit'] == 1:
            score += 10
        # 느리게 상대 코트 중앙으로 가는 약한 반환 감점 — 확정 킬은 제외
        if (r['frames'] > 36 and dist_from_opp < 110
                and not (r['powerTouches'] > 0 and r['oppWindow'] <= 2)):
            score -= 120
        return score
    if not on_opp and r['touches'] == 0:
        return None  # 공에 못 닿음
    # 내 코트 착지 = 범프로 공격권 유지 (나쁜 반환보다는 낫다)
    budget = 4 - g_touches
    if act['hit'] == 0 and r['touches'] > 0 and budget - r['touches'] >= 1:
        return -80
    return -500 + (50 if act['hit'] == 0 else 0)


# ── 공중 정책 선택 — 조작 후보 12개 중 최고 점수를 고른다 ────────────
def choose_air_policy(s, me0, min_x, max_x):
    """히트 정책 9종(x×y 조합) + 범프 정책 3종을 전부 점수화.

    state 2(파워히트 발동 중)에는 범프 정책으로 갈아탈 수 없다 —
    히트는 이미 발동됐고 입력만 중립이 되어 최악의 (0,0) 플랫이
    나가기 때문 (실측 자책 버그였음). 히트 후보끼리만 비교한다.
    반환: {'action', 'score'} 또는 None.
    """
    first = {'x': g_last_action['x'], 'y': g_last_action['y'],
             'hit': g_last_action['hit']}
    # state 2에선 범프 정책 전환 금지 (히트 발동 중 중립 = 자책 플랫)
    hit_only = me0['state'] == 2
    best = None
    for hit in ((1,) if hit_only else (1, 0)):
        yds = (1, 0, -1) if hit == 1 else (0,)
        for xd in (0, 1, -1):
            for yd in yds:
                act = {'x': xd, 'y': yd, 'hit': hit}
                score = score_air_action(s, me0, first, act, min_x, max_x)
                if score is None:
                    continue
                if best is None or score > best['score']:
                    best = {'action': act, 'score': score}
    return best


# ── 적응형 수비 위치 — 상대 공격 임박 시 "어디에 서야 하나" ──────────
def defense_target(s, min_x, max_x, fallback):
    """상대의 가능한 코스(파워히트 6종 + 무타격 궤적)의 착지점·비행
    시간을 전부 시뮬해, "최악 코스의 커버 부족"이 최소가 되는 위치를
    고른다(미니맥스).

    찍기 견제 1순위: 커버가 부족한 코스 중 비행이 짧은 것(≤10f ×1.6,
    ≤16f ×1.2)은 부족량을 무겁게 — 느린 코스는 보고 달려가 만회할 수
    있지만 찍기는 위치로만 막을 수 있다. 전 코스 커버 시엔 마진(음수
    deficit)을 최대화 — 과한 네트 쏠림은 후방 노출을 만든다 (실측).
    """
    is_right = s['side'] == 'RIGHT'
    contact_ball = ball_after(s['ball'], 2)  # 상대 접촉 시점 근사
    lands = []
    # 파워히트 6코스의 착지점 수집
    for xa in (0, 1):
        for yd in (1, 0, -1):
            land = power_hit_landing(contact_ball, xa, yd)
            ours = land['x'] >= NET_X if is_right else land['x'] <= NET_X
            if ours:
                lands.append(land)
    # 무타격 궤적 — 엔진 제공 낙하점 사용
    plain_frames = frames_to_landing(s['ball'])
    plain_x = s['ball']['expectedLandingPointX']
    plain_ours = plain_x >= NET_X if is_right else plain_x <= NET_X
    if plain_ours:
        lands.append({'x': plain_x, 'frames': plain_frames})
    if not lands:
        return fallback  # 우리 쪽으로 올 코스가 없음

    # 미니맥스: 4px 격자로 후보 위치를 훑는다
    best_x = fallback
    best_worst = float('inf')
    x = min_x
    while x <= max_x:
        worst = float('-inf')
        for land in lands:
            fr = land['frames']
            deficit = abs(x - land['x']) - (WALK_SPEED * fr + 38)
            if deficit > 0 and fr <= 10:
                deficit *= 1.6  # 찍기: 부족량 가중
            elif deficit > 0 and fr <= 16:
                deficit *= 1.2
            if deficit > worst:
                worst = deficit
        if worst < best_worst:
            best_worst = worst
            best_x = x
        x += 4
    return best_x


def jump_y(k):
    """점프 시작 후 k프레임 뒤 내 y (해석적).
    물리: vy=-16 시작, 매 프레임 +1 → y = 244 - 16k + k(k-1)/2.
    정점 k=16 (y=108)."""
    if k <= 0:
        return PLAYER_GROUND_Y
    y = PLAYER_GROUND_Y - 16 * k + (k * (k - 1)) // 2
    return PLAYER_GROUND_Y if y > PLAYER_GROUND_Y else y


def estimate_my_vy(s):
    """내 수직 속도 추정 (스냅샷에 없어서 직전 y와의 차이로 역산).
    d프레임 간 낙차 Δy = d*vy0 + d(d-1)/2 → 현재 vy = Δy/d + (d+1)/2.
    (d는 실제 tick 간격 — 틱 주기가 바뀌어도 정확)"""
    if g_prev is None or s['self']['state'] > 2:
        return -16
    d = max(1, s['tick'] - g_prev_tick)
    dy = s['self']['y'] - g_prev['selfY']
    return dy / d + (d + 1) / 2


# ── 일반 요격 계획 — 킬각이 없을 때의 기본 점프 판단 ─────────────────
def find_intercept(s, my_pred_x, min_x, max_x):
    """공의 미래 궤적을 훑어 요격 좋은 접촉 후보를 찾는다.

    후보: 하강 중 + 높이 밴드(Y_LO~Y_HI) + 내 코트 범위 + 걸어서 도달
    가능. 접촉 시점의 점프 나이가 AIR_MIN~AIR_MAX에 맞으면 지금 점프
    ({'jump': True}), 아직 이르면 접촉점 밑으로 미리 이동({'jump':
    False, 'targetX'}). "늦은 점프"인 이유: 점프 직후 히트를 장전할
    지연 시간이 필요 — 너무 일찍 뛰면 장전 전에 몸에 맞는다 (실측).
    """
    b = clone_ball(s['ball'])
    for k in range(1, 45):
        if step_ball(b):
            break  # 착지 — 탐색 종료
        if b['yV'] < 0:
            continue  # 하강 중인 공만
        if b['y'] < CFG['Y_LO'] or b['y'] > CFG['Y_HI']:
            continue  # 요격 높이 밴드
        if b['x'] < min_x - 20 or b['x'] > max_x + 20:
            continue  # 내 코트 범위 (여유 20)
        if abs(b['xV']) > 14:
            continue  # 빠른 횡단 공은 신뢰도 낮음

        air_age = k - LATENCY_FRAMES  # 지금 결정 → 다음 프레임 점프 시작
        walkable = WALK_SPEED * (k - 1) + 8
        if abs(b['x'] - my_pred_x) > walkable:
            continue

        # 접촉 시점의 내 점프 높이와 공 높이가 TOL 이내로 맞는가
        if (CFG['AIR_MIN'] <= air_age <= CFG['AIR_MAX']
                and abs(jump_y(air_age) - b['y']) <= CFG['TOL']):
            return {'jump': True, 'targetX': b['x']}  # 지금 점프!
        if air_age > CFG['AIR_MAX']:
            # 아직 이르다: 접촉점 밑으로 미리 이동해 타이밍을 기다린다
            return {'jump': False, 'targetX': b['x']}
    return None


# ── 터치 카운트 추정 — "한 진영 연속 5회 접촉 = 실점" 룰 대응 ────────
def update_touches(s):
    """스냅샷엔 터치 수가 없으므로 물리 예측으로 추정한다.

    직전 공 상태의 자유 비행 예측과 실제가 다르면(편차) 누군가 공을
    친 것 — 그 편차가 "내 근처 + 내 하프"면 우리 터치로 센다. 공이
    하프를 넘으면 리셋(룰과 동일). 결과는 공격 계획의 터치 예산으로
    쓰인다."""
    global g_touches, g_prev_ball_on_left
    ball_on_left = s['ball']['x'] < NET_X
    if g_prev_ball_on_left is not None and ball_on_left != g_prev_ball_on_left:
        g_touches = 0  # 하프 교대 → 리셋
    g_prev_ball_on_left = ball_on_left
    if s['meta']['rallyFrameCount'] < 4:
        g_touches = 0  # 랠리 시작 직후
        return
    if g_prev is None:
        return
    # 자유 비행 예측 vs 실제 (허용 오차 2px)
    predicted = ball_after(g_prev['ball'], s['tick'] - g_prev_tick)
    deviated = (abs(predicted['x'] - s['ball']['x']) > 2
                or abs(predicted['yV'] - s['ball']['yVelocity']) > 2)
    if deviated:
        near_me = (abs(s['ball']['x'] - s['self']['x']) < 90
                   and abs(s['ball']['y'] - s['self']['y']) < 110)
        my_half = (s['ball']['x'] < NET_X + 40 if s['side'] == 'LEFT'
                   else s['ball']['x'] > NET_X - 40)
        if near_me and my_half:
            g_touches += 1


# (시간·점수 기반 행동 변화는 제거 — SAFE 스톨이 공을 들고 있다가
#  상대에게 기회를 헌납하는 부작용이 커서, 항상 최선 공격으로 플레이)


# ── 이동 컨트롤러 (데드비트 제어) ────────────────────────────────────
def walk_to(target_x, my_pred_x):
    """"한 틱 뒤 위치 오차가 최소가 되는 입력"을 고른다.

    조작은 틱(기본 3프레임) 단위로 적용돼 이동이 18px 단위 — 단순
    데드존 제어는 지연과 결합해 목표를 ±18px씩 지나치는 왕복 진동을
    만든다 (실측 버그). 후보 {정지, ±step} 중 오차 최소를 선택, 동률
    이면 정지 유지."""
    dx = target_x - my_pred_x
    if -7 < dx < 7:
        return 0  # 미세 오차 무시 (디더링 방지)
    step = WALK_SPEED * g_group  # 한 결정 주기의 이동량 (기본 18px)
    best = 0
    best_err = abs(dx)
    if abs(dx - step) < best_err:
        best = 1
        best_err = abs(dx - step)
    if abs(dx + step) < best_err:
        best = -1
    return best


def fallback_action(s):
    """decide_core가 예외를 던졌을 때의 안전망 — 엔진이 주는 낙하점
    (expectedLandingPointX)을 향해 걷기만 한다 (자체 시뮬 미사용이라
    절대 실패하지 않음)."""
    x = 0
    dx = s['ball']['expectedLandingPointX'] - s['self']['x']
    if abs(dx) > 8:
        x = 1 if dx > 0 else -1
    return {'x': x, 'y': 0, 'hit': 0}


# ── 메인 판단 함수 ───────────────────────────────────────────────────
def decide_core(s):
    """매 틱 상황을 분류하고 해당 전략을 실행 (파일 상단 구조도 참고)."""
    global g_air_policy, g_group
    # 틱 주기는 조정될 수 있음 — 항상 스냅샷에서 읽는다 (가이드 준수)
    cfg = s.get('config') or {}
    tf = cfg.get('tickFrameGroupSize') or 0
    g_group = tf if tf > 0 else 3

    # 좌우 어느 코트든 동작하도록 방향·범위를 side 기준으로 계산
    is_right = s['side'] == 'RIGHT'
    min_x = NET_X + PLAYER_HALF if is_right else PLAYER_HALF
    max_x = GROUND_WIDTH - PLAYER_HALF if is_right else NET_X - PLAYER_HALF
    toward_net = -1 if is_right else 1  # 네트 쪽으로 가는 x 방향

    update_touches(s)  # 터치 예산 갱신

    me = s['self']
    ball = s['ball']

    # 다이빙(3)/기상(4)/승패 모션(5,6) 중엔 입력이 무시됨 → 중립
    if me['state'] >= 3:
        return {'x': 0, 'y': 0, 'hit': 0}

    # 지연 보정: 직전 입력이 1프레임 더 적용된 뒤의 내 위치 기준으로 판단
    # (그래야 목표점 오버슈트 왕복이 사라진다 — 실측 버그였음)
    my_pred_x = clamp(me['x'] + g_last_action['x'] * WALK_SPEED * LATENCY_FRAMES,
                      min_x, max_x)

    # ══ [분기 1] 공중 (state 1 점프 중 / state 2 파워히트 모션 중) ══
    # 엔진은 "접촉 순간"의 입력으로 스매시 코스를 정하므로, state 2에서도
    # 조준을 유지해야 한다 (중립이면 최저속 플랫으로 뭉개짐).
    if me['state'] == 1 or me['state'] == 2:
        vy = estimate_my_vy(s)
        me0 = {  # 시뮬 시작 상태 (내 몸 복원)
            'x': me['x'],
            'y': me['y'],
            'vy': vy,
            'state': me['state'],
            # state 2 모션 진행도는 frameNumber로 근사 복원
            'delay': 3 if (me['state'] == 2 and me['frameNumber'] == 0) else 0,
            'frameNo': me['frameNumber'] if me['state'] == 2 else 0,
            'collFlag': (abs(ball['x'] - me['x']) <= PLAYER_HALF
                         and abs(ball['y'] - me['y']) <= PLAYER_HALF),
        }
        # 커밋: 직전 정책을 재평가해 새 최선이 +15 초과로 낫지 않으면
        # 유지 — 매 틱 갈아치우면 요격 이동이 끊긴다 (실측 실패 패턴)
        first = {'x': g_last_action['x'], 'y': g_last_action['y'],
                 'hit': g_last_action['hit']}
        cur_score = None
        if g_air_policy is not None:
            cur_score = score_air_action(s, me0, first, g_air_policy,
                                         min_x, max_x)
        pol = choose_air_policy(s, me0, min_x, max_x)
        if cur_score is not None and cur_score > -400:
            if pol is None or pol['score'] <= cur_score + 15:
                return g_air_policy  # 기존 커밋 유지
        if pol is not None and pol['score'] > -400:
            g_air_policy = pol['action']  # 새 정책 커밋
            return pol['action']
        g_air_policy = None
        # 어떤 정책으로도 공에 관여 불가 — 착지 후 대비 위치로 이동
        landing_ours = (ball['expectedLandingPointX'] >= NET_X if is_right
                        else ball['expectedLandingPointX'] <= NET_X)
        if landing_ours:
            move_to = clamp(ball['expectedLandingPointX'], min_x, max_x)
        else:
            move_to = NET_X + 108 if is_right else NET_X - 108
        return {'x': walk_to(move_to, my_pred_x), 'y': 0, 'hit': 0}

    # ══ [분기 2] 지상 (state 0) ══
    g_air_policy = None  # 착지 → 공중 커밋 해제
    landing_x = ball['expectedLandingPointX']  # 엔진 제공 낙하 예측
    ball_ours = landing_x >= NET_X if is_right else landing_x <= NET_X
    land_frames = frames_to_landing(ball)

    # (BAND=0이라 현재 이 가드는 비활성 — 스윕 결과 낙하점 추적이 우세)
    ball_on_our_half = ball['x'] >= NET_X if is_right else ball['x'] <= NET_X
    opp_may_hit = (CFG['BAND'] == 1 and not ball_on_our_half
                   and abs(ball['x'] - s['opp']['x']) < 130)
    standby_c = NET_X + 108 if is_right else NET_X - 108  # 기본 대기(중앙)

    # ── [2-a] 수비: 공이 상대 것일 때 ──
    if not ball_ours or opp_may_hit:
        # 상대 히트 임박(공중이거나 공 근접)이면 미니맥스 위치로
        opp_imminent = (s['opp']['state'] == 1 or s['opp']['state'] == 2
                        or (abs(ball['x'] - s['opp']['x']) < 90
                            and abs(ball['y'] - s['opp']['y']) < 130))
        if opp_imminent:
            standby_t = defense_target(s, min_x, max_x, standby_c)
        elif not ball_ours:
            standby_t = standby_c
        else:
            standby_t = clamp(landing_x, standby_c - 45, standby_c + 45)
        return {'x': walk_to(standby_t, my_pred_x), 'y': 0, 'hit': 0}

    # ── [2-b] 공격: 공이 우리 것일 때 ──
    # 1순위 — 킬 점프: 벽뚫기·급락 각이 서면 즉시 점프
    kill = find_kill_jump(s, min_x, max_x)
    if kill is not None:
        g_air_policy = kill['smash']  # 점프 후 유지할 조준 미리 커밋
        return {'x': kill['jx'], 'y': -1, 'hit': 0}
    # 2순위 — 일반 요격: 타이밍 맞으면 점프, 이르면 미리 이동
    icept = find_intercept(s, my_pred_x, min_x, max_x)
    if icept is not None:
        jx = walk_to(icept['targetX'], my_pred_x)
        if icept['jump']:
            return {'x': jx, 'y': -1, 'hit': 0}
        return {'x': jx, 'y': 0, 'hit': 0}

    # ── [2-c] 리시브: 셋업 패스 ──
    # 몸 범프는 "몸 중심 반대쪽으로 오프셋//3 속도"로 튕기므로, 낙하점
    # 반대쪽에 offset만큼 비켜서면 공이 네트 앞 상공으로 뜬다 — 다음
    # 점프에서 최고의 코스가 나오는 위치 (썬더의 '패스' 단계에 해당).
    if g_touches >= 3:
        offset = 18  # 터치 임박 — 확실히 네트 너머로 보내는 강한 바운스
    else:
        # 바운스 후 재낙하까지 비행 프레임 근사 ≈ 2*튕김속도 + 2
        up_v = max(15, abs(ball_after(ball, land_frames - 1)['yV']))
        flight = 2 * up_v + 2
        hover_x = NET_X + 12 if is_right else NET_X - 12  # 네트 앞 목표
        need_xv = (hover_x - landing_x) / flight  # 필요한 수평 속도
        offset = clamp(js_round(3 * abs(need_xv)) + 1, 4, 26)
    target_x = clamp(landing_x - toward_net * offset, min_x, max_x)
    dx = target_x - my_pred_x
    x = walk_to(target_x, my_pred_x)

    # ── [2-d] 다이빙 세이브: 걸어서 못 닿는 낙하 ──
    # 찍기(빠른 낙하, ≤10프레임)는 ball.y 게이트를 면제해 다이빙 결정을
    # 앞당긴다 (실측: 상대 아래찍기 실점의 주 원인이었음)
    dist = abs(dx)
    if (land_frames < 24
            and dist > WALK_SPEED * land_frames + 6
            and dist <= DIVE_SPEED * land_frames + 44
            and (ball['y'] > 140 or land_frames <= 10)):
        return {'x': 1 if dx > 0 else -1, 'y': 0, 'hit': 1}  # 다이빙!

    return {'x': x, 'y': 0, 'hit': 0}


def save_prev(s):
    """다음 틱을 위한 상태 저장 (공 상태·내 y·tick)."""
    global g_prev, g_prev_tick
    g_prev = {
        'ball': {
            'x': s['ball']['x'],
            'y': s['ball']['y'],
            'xVelocity': s['ball']['xVelocity'],
            'yVelocity': s['ball']['yVelocity'],
        },
        'selfY': s['self']['y'],
    }
    g_prev_tick = s['tick']


def decide(s):
    """엔진이 매 틱 호출하는 진입점.

    decide_core가 예외를 던지면(미래의 규칙 변화 등) fallback_action으로
    최소한의 수비를 유지한다 — 봇이 멈추는 것보다 단순하게라도 움직이는
    게 낫다. 반환값은 항상 유효한 {'x','y','hit'} dict.
    """
    global g_last_action
    try:
        action = decide_core(s)
    except Exception:
        action = fallback_action(s)
    g_last_action = action  # 다음 틱의 지연 보정에 사용
    save_prev(s)
    return action
