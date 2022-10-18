Encryption
=======

Hookshot supports end-to-bridge encryption via [MSC3202](https://github.com/matrix-org/matrix-spec-proposals/pull/3202). As such, encryption requires hookshot to be connected to a homeserver that supports that MSC, such as [Synapse](#running-with-synapse).

## Enabling encryption in Hookshot

In order for hookshot to use encryption, it must be configured as follows:
- The `encryption.storagePath` setting must point to a directory that hookshot has permissions to write files into. If running with Docker, this path should be within a volume (for persistency).
- [Workers](./workers.md) must be enabled.

If you ever reset your homeserver's state, ensure you also reset hookshot's encryption state. This includes clearing the `encryption.storagePath` directory and all worker state stored in your redis instance. Otherwise, hookshot may fail on start up with registration errors.

Also ensure that hookshot's appservice registration file contains every line from `registration.sample.yml` that appears after the `If enabling encryption` comment. Note that changing the registration file may require restarting the homeserver that hookshot is connected to.

## Running with Synapse

[Synapse](https://github.com/matrix-org/synapse/) has functional support for MSC3202 as of [v1.63.0](https://github.com/matrix-org/synapse/releases/tag/v1.63.0). To enable it, add the following section to Synapse's configuration file (typically named `homeserver.yaml`):

```yaml
experimental_features:
  msc3202_device_masquerading: true
  msc3202_transaction_extensions: true
  msc2409_to_device_messages_enabled: true
```
