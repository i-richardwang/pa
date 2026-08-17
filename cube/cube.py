from cube import config


@config("context_to_groups")
def context_to_groups(ctx):
    security_context = ctx.get("securityContext") or {}
    groups = security_context.get("groups") or []
    return [group for group in groups if isinstance(group, str)]
