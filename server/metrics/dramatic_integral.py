"""
Pedagogical Dramatic Tension Module - Dramatic Integral S(t)
Modélisation mathématique discrète : S(t) = sum_{tau=0}^{t} [V(tau) * P(t | tau)] * C(t)
"""

def _get_words(text: str) -> set[str]:
    stop_words = {
        "avec", "dans", "pour", "sur", "sous", "vers", "dont", "mais",
        "quoi", "quel", "quels", "quelles", "cette", "cela", "leur",
        "nous", "vous", "elles", "sont", "être", "avoir", "faire", "dire",
        "plus", "tout", "tous", "cette", "dans", "avec"
    }
    words = {
        w.strip("?.!,;:'\"()").lower()
        for w in text.split()
        if len(w) > 3
    }
    return words - stop_words


def calculate_dramatic_tension(history: list[dict], current_message: str, context: str) -> dict:
    """
    Calculate the dramatic tension S(t) from the user's message history,
    current query, and corpus context.
    
    Args:
        history: list of {"role": str, "content": str}
        current_message: user's latest query
        context: retrieved document chunks
        
    Returns:
        dict: containing the tension score, maieutic posture trigger, and parameters
    """
    # 1. Extract all user messages from history, appending the current message as the latest
    user_messages = [msg["content"] for msg in history if msg.get("role") == "user"]
    user_messages.append(current_message)
    
    t_index = len(user_messages) - 1  # current time t
    
    # 2. V(tau) - Actions volume (cognitive investment proxy)
    # Measured by word count at each step tau
    v_values = [float(len(msg.split())) for msg in user_messages]
    
    # 3. P(t | tau) - Retroaction weight (after-coup Nachträglichkeit)
    # Semantic keyword overlap with temporal decay
    current_words = _get_words(current_message)
    p_weights = []
    
    for tau, past_msg in enumerate(user_messages):
        if tau == t_index:
            p_weights.append(1.0)  # Maximum weight for the present moment
            continue
            
        past_words = _get_words(past_msg)
        overlap = len(current_words & past_words)
        
        # Temporal decay: further messages have less weight, but semantic overlap boosts it
        decay = 1.0 + float(t_index - tau)
        p_weights.append(float(overlap) / decay)
        
    # Sum over V(tau) * P(t | tau)
    retroaction_sum = sum(v_values[tau] * p_weights[tau] for tau in range(len(user_messages)))
    
    # 4. C(t) - Context Friction Tensor
    # Friction is measured by the ratio of new query words not present in the retrieved context
    if not context.strip():
        friction = 1.0  # Maximum friction if context is empty (need file)
    else:
        context_words = _get_words(context)
        if not current_words:
            friction = 0.5
        else:
            unmatched = current_words - context_words
            friction = float(len(unmatched)) / float(len(current_words))
            
    # Keep friction bounded between [0.2, 1.0]
    friction = max(0.2, min(1.0, friction))
    
    # 5. S(t) - Global Accumulated Tension
    tension = retroaction_sum * friction
    
    # Critical threshold for maieutic stance shift
    CRITICAL_THRESHOLD = 15.0
    maieutic_posture = tension < CRITICAL_THRESHOLD
    
    return {
        "tension_score": round(tension, 2),
        "maieutic_posture": maieutic_posture,
        "context_friction": round(friction, 2),
        "tokens_flow": round(v_values[-1], 2),
        "retroaction_weight": round(retroaction_sum, 2)
    }
