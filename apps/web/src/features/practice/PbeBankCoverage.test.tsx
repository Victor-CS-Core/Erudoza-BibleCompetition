import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PbeBankCoverage } from './PbeBankCoverage';
it('shows gaps without claiming chapter readiness', () => {
 render(<PbeBankCoverage coveredSources={3} assignedSources={8} singleVariantTargets={2} />);
 expect(screen.getByText('3 of 8 assigned passages have questions')).toBeVisible();
 expect(screen.getByText('2 targets need another question variant')).toBeVisible();
 expect(screen.queryByText('Chapter ready')).toBeNull();
});
