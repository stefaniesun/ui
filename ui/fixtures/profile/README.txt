本目录使用自制同结构测试图进行流水线验证，不包含 UI Notes 或第三方 App 原始截图。
如已获得参考截图使用权限，请将其保存为 reference/default.png，并保持设备逻辑尺寸 396×842；随后运行：
1. ui-rebuild analyze fixtures/profile
2. ui-rebuild run fixtures/profile --max-rounds 3
3. ui-rebuild review fixtures/profile
