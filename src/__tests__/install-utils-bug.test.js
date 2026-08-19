import { describe, it, expect, beforeEach } from 'vitest';
import {
  addPluginReference,
  removeOldPluginReferences,
  isIdleContinuePath,
} from '../cli/install-utils.js';

describe('Install Utils Bug Reproduction Tests', () => {
  describe('Duplicate Plugin References Bug', () => {
    it('should remove duplicate plugin references when upgrading from local to CLI installation', () => {
      const config = {
        plugin: [
          '../other-path/idle-continue/index.js',
          'opencode-idle-continue'
        ],
        '$schema': 'https://opencode.ai/config.json'
      };

      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // Should only have one reference, not duplicates
      expect(config.plugin).toHaveLength(1);
      expect(config.plugin).toContain('opencode-idle-continue');
      expect(config.plugin).not.toContain('../other-path/idle-continue/index.js');
    });

    it('should prevent adding duplicate references', () => {
      const config = {
        plugin: ['opencode-idle-continue'],
        '$schema': 'https://opencode.ai/config.json'
      };

      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // Should still only have one reference
      expect(config.plugin).toHaveLength(1);
      expect(config.plugin).toContain('opencode-idle-continue');
    });

    it('should handle multiple different path formats', () => {
      const config = {
        plugin: [
          './plugins/idle-continue/index.js',
          '../custom-dir/idle-continue/index.js',
          '/absolute/path/idle-continue/index.js',
          'opencode-idle-continue'
        ],
        '$schema': 'https://opencode.ai/config.json'
      };

      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // Should remove all local path references
      expect(config.plugin).toHaveLength(1);
      expect(config.plugin).toContain('opencode-idle-continue');
      expect(config.plugin).not.toContain('./plugins/idle-continue/index.js');
      expect(config.plugin).not.toContain('../custom-dir/idle-continue/index.js');
      expect(config.plugin).not.toContain('/absolute/path/idle-continue/index.js');
    });
  });

  describe('Schema Field Loss Bug', () => {
    it('should preserve existing $schema field when upgrading', () => {
      const config = {
        plugin: ['../other-path/idle-continue/index.js', 'opencode-idle-continue'],
        '$schema': 'https://opencode.ai/config.json'
      };

      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // Schema should be preserved
      expect(config['$schema']).toBe('https://opencode.ai/config.json');
    });

    it('should handle schema field without $ prefix', () => {
      const config = {
        plugin: ['../other-path/idle-continue/index.js'],
        'schema': 'https://opencode.ai/config.json'
      };

      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // Should have only $schema, not schema
      expect(config['$schema']).toBe('https://opencode.ai/config.json');
      expect(config['schema']).toBeUndefined();
    });

    it('should add default schema when none exists', () => {
      const config = {
        plugin: []
      };

      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      expect(config['$schema']).toBe('https://opencode.ai/config.json');
    });

    it('should clean up duplicate schema fields', () => {
      const config = {
        plugin: [],
        'schema': 'https://opencode.ai/config.json',
        '$schema': 'https://opencode.ai/config.json'
      };

      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // Should only have $schema
      expect(config['$schema']).toBe('https://opencode.ai/config.json');
      expect(config['schema']).toBeUndefined();
    });
  });

  describe('Complex Config Preservation Tests', () => {
    it('should preserve all other config when no plugins exist', () => {
      const originalConfig = {
        "$schema": "https://opencode.ai/config.json",
        "model": "example/model-4-26b-a4b-it",
        "mcp": {
          "playwright": {
            "type": "local",
            "command": ["npx", "@example/mcp@latest"],
            "enabled": true
          }
        },
        "disabled_providers": [],
        "provider": {
          "example-provider": {
            "name": "example-code",
            "npm": "@ai-sdk/openai-compatible",
            "options": {
              "apiKey": "sk-test-key-12345",
              "baseURL": "http://192.168.1.100:3000/v1"
            },
            "models": {
              "example-code": {
                "name": "model-122b"
              },
              "gemma-4-26b-a4b-it": {
                "name": "gemma-4-26b"
              }
            }
          }
        }
      };

      const config = JSON.parse(JSON.stringify(originalConfig));
      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // All non-plugin fields should be preserved
      expect(config.model).toBe(originalConfig.model);
      expect(config.mcp).toEqual(originalConfig.mcp);
      expect(config.disabled_providers).toEqual(originalConfig.disabled_providers);
      expect(config.provider).toEqual(originalConfig.provider);
      expect(config['$schema']).toBe(originalConfig['$schema']);
      
      // Plugin should be added
      expect(config.plugin).toContain('opencode-idle-continue');
    });

    it('should preserve other config when other plugins exist', () => {
      const originalConfig = {
        "$schema": "https://opencode.ai/config.json",
        "model": "example/model-4-26b-a4b-it",
        "mcp": {
          "playwright": {
            "type": "local",
            "command": ["npx", "@example/mcp@latest"],
            "enabled": true
          }
        },
        "disabled_providers": ["deprecated-provider"],
        "provider": {
          "example-provider": {
            "name": "example-code",
            "npm": "@ai-sdk/openai-compatible",
            "options": {
              "apiKey": "sk-test-key-12345",
              "baseURL": "http://192.168.1.100:3000/v1"
            }
          }
        },
        "plugin": ["other-plugin", "another-plugin"]
      };

      const config = JSON.parse(JSON.stringify(originalConfig));
      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // All non-plugin fields should be preserved
      expect(config.model).toBe(originalConfig.model);
      expect(config.mcp).toEqual(originalConfig.mcp);
      expect(config.disabled_providers).toEqual(originalConfig.disabled_providers);
      expect(config.provider).toEqual(originalConfig.provider);
      expect(config['$schema']).toBe(originalConfig['$schema']);
      
      // Original plugins should be preserved + new one added
      expect(config.plugin).toContain('other-plugin');
      expect(config.plugin).toContain('another-plugin');
      expect(config.plugin).toContain('opencode-idle-continue');
      expect(config.plugin).toHaveLength(3);
    });

    it('should preserve other config when same plugin exists with other config', () => {
      const originalConfig = {
        "$schema": "https://opencode.ai/config.json",
        "model": "example/model-4-26b-a4b-it",
        "mcp": {
          "playwright": {
            "type": "local",
            "command": ["npx", "@example/mcp@latest"],
            "enabled": true
          }
        },
        "disabled_providers": [],
        "provider": {
          "example-provider": {
            "name": "example-code",
            "npm": "@ai-sdk/openai-compatible",
            "options": {
              "apiKey": "sk-test-key-12345",
              "baseURL": "http://192.168.1.100:3000/v1"
            }
          }
        },
        "plugin": ["opencode-idle-continue"]
      };

      const config = JSON.parse(JSON.stringify(originalConfig));
      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // All non-plugin fields should be preserved
      expect(config.model).toBe(originalConfig.model);
      expect(config.mcp).toEqual(originalConfig.mcp);
      expect(config.disabled_providers).toEqual(originalConfig.disabled_providers);
      expect(config.provider).toEqual(originalConfig.provider);
      expect(config['$schema']).toBe(originalConfig['$schema']);
      
      // Plugin should not be duplicated
      expect(config.plugin).toHaveLength(1);
      expect(config.plugin).toContain('opencode-idle-continue');
    });

    it('should preserve other config when same plugin exists with different installation method', () => {
      const originalConfig = {
        "$schema": "https://custom-schema.com/config.json",
        "model": "custom/model-8b-a4b-it",
        "mcp": {
          "filesystem": {
            "type": "local",
            "enabled": true
          }
        },
        "disabled_providers": ["old-provider"],
        "provider": {
          "custom-provider": {
            "name": "custom-code",
            "options": {
              "apiKey": "sk-custom-key-67890",
              "baseURL": "http://10.0.0.1:8080/api"
            }
          }
        },
        "plugin": [
          "./plugins/idle-continue/index.js",
          "other-plugin"
        ]
      };

      const config = JSON.parse(JSON.stringify(originalConfig));
      addPluginReference(config, './plugins/idle-continue/index.js', { verbose: false });

      // All non-plugin fields should be preserved
      expect(config.model).toBe(originalConfig.model);
      expect(config.mcp).toEqual(originalConfig.mcp);
      expect(config.disabled_providers).toEqual(originalConfig.disabled_providers);
      expect(config.provider).toEqual(originalConfig.provider);
      expect(config['$schema']).toBe(originalConfig['$schema']);
      
      // Other plugin should be preserved
      expect(config.plugin).toContain('other-plugin');
      
      // Plugin should not be duplicated
      expect(config.plugin).toHaveLength(2);
      expect(config.plugin).toContain('./plugins/idle-continue/index.js');
    });

    it('should upgrade from local to CLI installation while preserving other config', () => {
      const originalConfig = {
        "$schema": "https://example-schema.com/config.json",
        "model": "example/model-70b-it",
        "mcp": {
          "browser": {
            "type": "local",
            "enabled": true
          }
        },
        "disabled_providers": ["test-provider"],
        "provider": {
          "test-provider": {
            "name": "test-model",
            "options": {
              "apiKey": "sk-test-api-key",
              "baseURL": "http://localhost:5000/v1"
            }
          }
        },
        "plugin": [
          "../custom-path/idle-continue/index.js",
          "third-plugin"
        ]
      };

      const config = JSON.parse(JSON.stringify(originalConfig));
      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // All non-plugin fields should be preserved
      expect(config.model).toBe(originalConfig.model);
      expect(config.mcp).toEqual(originalConfig.mcp);
      expect(config.disabled_providers).toEqual(originalConfig.disabled_providers);
      expect(config.provider).toEqual(originalConfig.provider);
      expect(config['$schema']).toBe(originalConfig['$schema']);
      
      // Third plugin should be preserved, local installation should be replaced
      expect(config.plugin).toContain('third-plugin');
      expect(config.plugin).toContain('opencode-idle-continue');
      expect(config.plugin).not.toContain('../custom-path/idle-continue/index.js');
      expect(config.plugin).toHaveLength(2);
    });

    it('should preserve complex nested structures in config', () => {
      const originalConfig = {
        "$schema": "https://opencode.ai/config.json",
        "model": "example/model-4-26b-a4b-it",
        "mcp": {
          "playwright": {
            "type": "local",
            "command": ["npx", "@example/mcp@latest"],
            "enabled": true
          },
          "filesystem": {
            "type": "local",
            "enabled": false
          }
        },
        "disabled_providers": ["old-1", "old-2"],
        "provider": {
          "provider-1": {
            "name": "model-1",
            "npm": "@ai-sdk/model-1",
            "options": {
              "apiKey": "sk-key-1",
              "baseURL": "http://192.168.1.1:3001/v1",
              "timeout": 30000
            },
            "models": {
              "model-1": {
                "name": "gpt-4"
              },
              "model-2": {
                "name": "gpt-3.5"
              }
            }
          },
          "provider-2": {
            "name": "model-2",
            "options": {
              "apiKey": "sk-key-2",
              "baseURL": "http://192.168.1.2:3002/v1"
            }
          }
        }
      };

      const config = JSON.parse(JSON.stringify(originalConfig));
      addPluginReference(config, 'opencode-idle-continue', { verbose: false });

      // All complex nested structures should be preserved exactly
      expect(JSON.stringify(config.mcp)).toBe(JSON.stringify(originalConfig.mcp));
      expect(JSON.stringify(config.disabled_providers)).toBe(JSON.stringify(originalConfig.disabled_providers));
      expect(JSON.stringify(config.provider)).toBe(JSON.stringify(originalConfig.provider));
      expect(config['$schema']).toBe(originalConfig['$schema']);
      
      // Plugin should be added
      expect(config.plugin).toContain('opencode-idle-continue');
    });
  });

  describe('Path Detection Function Tests', () => {
    it('should detect various path formats as idle-continue paths', () => {
      const paths = [
        './plugins/idle-continue/index.js',
        '../other-path/idle-continue/index.js',
        '/absolute/path/idle-continue/index.js',
        'C:\\path\\to\\idle-continue\\index.js',
        'relative/path/idle-continue/index.js',
        'idle-continue/index.js'
      ];

      paths.forEach(path => {
        expect(isIdleContinuePath(path)).toBe(true);
      });
    });

    it('should not detect non-idle-continue paths', () => {
      const paths = [
        './other-plugin/index.js',
        'opencode-idle-continue',
        'some-other-idle-continue/index.js',
        'idle-continue-other/index.js',
        'idle-continue.js',
        'idle-continue/index.ts'
      ];

      paths.forEach(path => {
        expect(isIdleContinuePath(path)).toBe(false);
      });
    });
  });

  describe('removeOldPluginReferences Edge Cases', () => {
    it('should handle empty plugin array', () => {
      const config = { plugin: [] };
      const result = removeOldPluginReferences(config, { verbose: false });

      expect(config.plugin).toHaveLength(0);
      expect(result.removedRefs).toHaveLength(0);
    });

    it('should handle undefined plugin field', () => {
      const config = {};
      const result = removeOldPluginReferences(config, { verbose: false });

      expect(config.plugin).toBeDefined();
      expect(config.plugin).toHaveLength(0);
      expect(result.removedRefs).toHaveLength(0);
    });

    it('should handle versioned plugin references', () => {
      const config = {
        plugin: [
          'opencode-idle-continue@1.0.0',
          'opencode-idle-continue@latest',
          'other-plugin'
        ]
      };

      const result = removeOldPluginReferences(config, { verbose: false });

      expect(config.plugin).not.toContain('opencode-idle-continue@1.0.0');
      expect(config.plugin).not.toContain('opencode-idle-continue@latest');
      expect(config.plugin).toContain('other-plugin');
    });
  });
});