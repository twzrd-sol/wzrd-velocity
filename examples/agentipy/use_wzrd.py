"""
WZRD Velocity Oracle integration for AgentiPy.

Provides AI model velocity signals, attention-weighted deposits, and CCM claims
via the WZRD Liquid Attention Protocol on Solana.

Install: pip install wzrd-client>=0.5.0

Usage with AgentiPy:
    from agentipy.agent import SolanaAgentKit
    from use_wzrd import WZRDManager

    agent = SolanaAgentKit(...)
    pick = WZRDManager.pick_model(agent, task="code")
    signals = WZRDManager.get_momentum(agent, min_confidence=0.7)
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# WZRD API base URL (public, no auth for signal reads)
DEFAULT_API_URL = "https://api.twzrd.xyz"


class WZRDManager:
    """Manager class for WZRD Liquid Attention Protocol operations."""

    @staticmethod
    def pick_model(
        agent: Any,
        task: str = "general",
        candidates: Optional[List[str]] = None,
        fallback: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Pick the best AI model for a task using WZRD velocity signals.

        Uses real-time velocity data from 4 platforms (HuggingFace, GitHub,
        OpenRouter, ArtificialAnalysis) to recommend the model with the
        highest momentum for the given task type.

        :param agent: SolanaAgentKit instance (used for config, not signing).
        :param task: Task type — "code", "chat", "reasoning", "general".
        :param candidates: Optional list of model IDs to filter.
        :param fallback: Fallback model if no signal available.
        :return: Dict with model_id, score, platform, velocity_ema, confidence.
        """
        try:
            from wzrd import pick_details

            result = pick_details(
                task=task,
                candidates=candidates,
                fallback=fallback,
            )
            return {
                "success": True,
                "model_id": result.model_id,
                "score": result.score,
                "platform": result.platform,
                "velocity_ema": getattr(result, "velocity_ema", None),
                "confidence": getattr(result, "confidence", None),
                "task": task,
            }
        except ImportError:
            logger.error("wzrd-client not installed. Run: pip install wzrd-client>=0.3.0")
            return {"success": False, "error": "wzrd-client not installed"}
        except Exception as e:
            logger.error(f"WZRD pick_model error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    @staticmethod
    def get_momentum(
        agent: Any,
        min_confidence: float = 0.0,
        limit: int = 20,
    ) -> Optional[Dict[str, Any]]:
        """Get momentum signals for all tracked AI models.

        Returns velocity, acceleration, and quality metrics for 100+ models
        across HuggingFace, GitHub, OpenRouter, and ArtificialAnalysis.

        :param agent: SolanaAgentKit instance.
        :param min_confidence: Minimum confidence threshold (0.0-1.0).
        :param limit: Max models to return.
        :return: Dict with list of model signals.
        """
        try:
            from wzrd import WZRDClient

            client = WZRDClient()
            signals = client.momentum(min_confidence=min_confidence, limit=limit)
            return {
                "success": True,
                "models": [
                    {
                        "model_id": s.model_id,
                        "platform": s.platform,
                        "score": s.score,
                        "velocity_ema": getattr(s, "velocity_ema", None),
                        "confidence": getattr(s, "confidence", None),
                    }
                    for s in signals
                ],
                "count": len(signals),
            }
        except ImportError:
            return {"success": False, "error": "wzrd-client not installed"}
        except Exception as e:
            logger.error(f"WZRD get_momentum error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    @staticmethod
    def compare_models(
        agent: Any,
        model_ids: List[str],
    ) -> Optional[Dict[str, Any]]:
        """Compare velocity signals between specific models.

        :param agent: SolanaAgentKit instance.
        :param model_ids: List of model IDs to compare.
        :return: Dict with comparison data.
        """
        try:
            from wzrd import compare

            result = compare(model_ids)
            return {
                "success": True,
                "models": result,
            }
        except ImportError:
            return {"success": False, "error": "wzrd-client not installed"}
        except Exception as e:
            logger.error(f"WZRD compare error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    @staticmethod
    def shortlist(
        agent: Any,
        task: str = "general",
        top_n: int = 5,
    ) -> Optional[Dict[str, Any]]:
        """Get top N models for a task, ranked by velocity.

        :param agent: SolanaAgentKit instance.
        :param task: Task type — "code", "chat", "reasoning".
        :param top_n: Number of models to return.
        :return: Dict with ranked model list.
        """
        try:
            from wzrd import shortlist

            models = shortlist(task=task, top_n=top_n)
            return {
                "success": True,
                "models": models,
                "task": task,
            }
        except ImportError:
            return {"success": False, "error": "wzrd-client not installed"}
        except Exception as e:
            logger.error(f"WZRD shortlist error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    @staticmethod
    def authenticate(
        agent: Any,
        api_url: str = DEFAULT_API_URL,
    ) -> Optional[Dict[str, Any]]:
        """Authenticate an agent via Ed25519 challenge/verify.

        Enables agent-specific features: reporting picks, earning CCM,
        claiming rewards. Requires a Solana keypair.

        :param agent: SolanaAgentKit instance (uses private_key for signing).
        :param api_url: WZRD API base URL.
        :return: Dict with bearer token (24h TTL).
        """
        try:
            from wzrd import WZRDAgent, load_keypair

            wzrd_agent = WZRDAgent(
                keypair=agent.wallet,
                api_url=api_url,
            )
            session = wzrd_agent.authenticate()
            return {
                "success": True,
                "token": session.token,
                "pubkey": session.pubkey,
                "expires_at": session.expires_at,
            }
        except ImportError:
            return {"success": False, "error": "wzrd-client not installed"}
        except Exception as e:
            logger.error(f"WZRD authenticate error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    @staticmethod
    def report_pick(
        agent: Any,
        model_id: str,
        task: str,
        token: str,
        api_url: str = DEFAULT_API_URL,
    ) -> Optional[Dict[str, Any]]:
        """Report a model pick to earn CCM rewards.

        Agents that report which models they use earn CCM tokens
        based on quality and consistency. Requires prior authentication.

        :param agent: SolanaAgentKit instance.
        :param model_id: The model ID that was selected.
        :param task: The task type it was used for.
        :param token: Bearer token from authenticate().
        :param api_url: WZRD API base URL.
        :return: Dict with report confirmation.
        """
        try:
            import requests

            response = requests.post(
                f"{api_url}/v1/agent/report",
                json={"model_id": model_id, "task": task},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                timeout=10,
            )
            response.raise_for_status()
            return {"success": True, **response.json()}
        except Exception as e:
            logger.error(f"WZRD report_pick error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    @staticmethod
    def get_earned(
        agent: Any,
        token: str,
        api_url: str = DEFAULT_API_URL,
    ) -> Optional[Dict[str, Any]]:
        """Check earned CCM rewards for an authenticated agent.

        :param agent: SolanaAgentKit instance.
        :param token: Bearer token from authenticate().
        :param api_url: WZRD API base URL.
        :return: Dict with pending_ccm, claimable_ccm, total_earned_ccm.
        """
        try:
            import requests

            response = requests.get(
                f"{api_url}/v1/agent/earned",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            response.raise_for_status()
            return {"success": True, **response.json()}
        except Exception as e:
            logger.error(f"WZRD get_earned error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
