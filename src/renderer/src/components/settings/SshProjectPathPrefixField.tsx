import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'

export function SshProjectPathPrefixField({
  value,
  disabled,
  onChange
}: {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="ssh-project-path-prefix">
        {translate(
          'auto.components.settings.SshTargetForm.projectPathPrefix',
          'Project path prefix'
        )}
      </Label>
      <Input
        id="ssh-project-path-prefix"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={translate(
          'auto.components.settings.SshTargetForm.projectPathPrefixPlaceholder',
          '~ (home folder)'
        )}
        spellCheck={false}
      />
      <p className="text-[11px] text-muted-foreground">
        {translate(
          'auto.components.settings.SshTargetForm.projectPathPrefixHelp',
          'A project under your home folder on this computer is found at the same path under this prefix, so setting it up on this host takes one click.'
        )}
      </p>
    </div>
  )
}
