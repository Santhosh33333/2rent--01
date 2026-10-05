import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { AnimatedPage } from '../../components/AnimatedPage'
import { AgentPanel } from '../../components/agent/AgentPanel'

/**
 * The /ai route is a thin host for the same AgentPanel the floating button uses.
 *
 * The previous version of this page posted to /ai/ask, which answered from
 * keyword rules and guessed a result shape client-side. It reported partners and
 * bookings it had not verified, so it was replaced rather than extended: both
 * entry points now go through the role-filtered tool registry, which only lets
 * the assistant describe data it actually read.
 */
export function AiAssistantPage() {
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Nabri Assistant"
        subtitle="Answers come from your live account data — nothing is guessed."
      />
      <AnimatedPage>
        <AgentPanel open variant="inline" onClose={() => navigate(-1)} />
      </AnimatedPage>
    </div>
  )
}