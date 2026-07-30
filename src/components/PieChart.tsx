import React from 'react';
import { Svg, G, Circle } from 'react-native-svg';

interface PieChartProps {
  data: { name: string; percentage: number; color: string }[];
  size?: number;
  strokeWidth?: number;
}

const PieChart: React.FC<PieChartProps> = ({ 
  data, 
  size = 100, 
  strokeWidth = 20 
}) => {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativePercentage = 0;

  return (
    <Svg 
      width={size} 
      height={size} 
      viewBox={`0 0 ${size} ${size}`}
    >
      <G rotation="-90" origin={`${center},${center}`}>
        {data.map((item, index) => {
          const dashArray = `${(item.percentage / 100) * circumference} ${circumference}`;
          const dashOffset = -(cumulativePercentage / 100) * circumference;
          cumulativePercentage += item.percentage;

          return (
            <Circle
              key={item.name}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={item.color}
              strokeWidth={strokeWidth}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          );
        })}
      </G>
    </Svg>
  );
};

export default PieChart;