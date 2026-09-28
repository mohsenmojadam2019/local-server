# Tool annotation justifications

| Tool | readOnly | openWorld | destructive | Scope | Justification |
|---|---:|---:|---:|---|---|
| whoami | true | false | false | profile:read | Reads only the linked GodControl account profile. |
| devices_list | true | false | false | devices:read | Lists only devices in the authenticated account. |
| device_ping | true | false | false | devices:read | Reads connectivity for one private device. |
| system_info | true | false | false | system:read | Reads bounded system information. |
| list_directory | true | false | false | files:read | Lists a policy-bounded private filesystem path. |
| get_file_info | true | false | false | files:read | Reads metadata only. |
| fs_read | true | false | false | files:read | Reads bounded file content only. |
| search | true | false | false | files:read | Searches only configured private roots. |
| git_status | true | false | false | git:read | Reads repository status. |
| git_diff | true | false | false | git:read | Reads repository changes. |
| process_start | false | false | false | process:run | Starts an allowlisted process, changing runtime state without inherently causing irreversible external effects. |
| process_read | true | false | false | process:run | Reads output from an existing process session. |
| file_write | false | false | false | files:write | Creates or updates data only inside an explicitly writable root. |
| file_edit | false | false | false | files:write | Applies an exact-text edit only inside an explicitly writable root. |
| file_remove | false | false | true | files:write | Deletes a path and can be irreversible. |

All tools are `openWorldHint=false` because they act on bounded authenticated private devices rather than arbitrary public internet entities.
