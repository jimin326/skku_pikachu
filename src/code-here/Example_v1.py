def decide(s):
    NET_X = 216
    GROUND_WIDTH = 432
    PLAYER_HALF_LENGTH = 32
    toward_net = -1 if s['side'] == 'RIGHT' else 1

    own_near = NET_X if s['side'] == 'RIGHT' else 0
    own_far  = GROUND_WIDTH if s['side'] == 'RIGHT' else NET_X
    standby_x = (own_near + own_far) / 2

    landing_on_own_side = (
        s['ball']['expectedLandingPointX'] > own_near
        and s['ball']['expectedLandingPointX'] < own_far
    )

    if landing_on_own_side:
        target_x = s['ball']['expectedLandingPointX'] - toward_net * 12
    else:
        target_x = standby_x

    dx = target_x - s['self']['x']
    x = 0
    if abs(dx) > 6:
        x = 1 if dx > 0 else -1

    y = 0
    x_aligned = abs(s['ball']['x'] - s['self']['x']) < PLAYER_HALF_LENGTH
    ball_slow_sideways = abs(s['ball']['xVelocity']) < 5
    ball_clearly_high = s['ball']['y'] < 150
    if (
        s['self']['state'] == 0
        and x_aligned
        and ball_slow_sideways
        and ball_clearly_high
        and s['ball']['yVelocity'] > 0
    ):
        y = -1

    return {'x': x, 'y': y, 'hit': 0}